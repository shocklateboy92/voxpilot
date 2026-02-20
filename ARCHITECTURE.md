# VoxPilot — Architecture Document

## Goal

VoxPilot is a **self-hosted, web-based AI coding assistant** — an alternative to cloud-hosted tools like Claude Code and GitHub Copilot. It runs on your local machine and exposes a web UI, enabling **remote development from mobile devices** (phone, tablet) by connecting to the local instance over the network.

## Current State

**Agentic coding assistant** powered by GPT-4o (etc.) via the **GitHub Models API**. Users authenticate with GitHub OAuth; their access token is reused as the API key for inference. The LLM can call read-only tools (read files, search code, list directories) through an agentic loop that executes tools and feeds results back until the task is done. Conversations (including tool call/result messages) are persisted in SQLite.

## Stack

- **Backend**: TypeScript 5.9, Bun 1.3, Hono 4, Zod v4, Drizzle ORM, `markdown-it`, Biome
- **Frontend**: SolidJS 1.9 + TypeScript 5.7, Vite, `openapi-fetch`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM (WAL mode, foreign keys enabled)
- **Task runner**: `just` (see Justfile for all recipes)
- **Tests**: `bun test` with `mock.module()`, in-memory SQLite

## Architecture

```
Browser (SolidJS SPA)
  │  openapi-fetch, EventSource, cookies
  │
  ▼  HTTP/JSON + SSE
Hono (Bun :8000)
  ├── /api/auth/*                    → GitHub OAuth (fetch)     → github.com
  ├── /api/sessions/*                → Session CRUD (Drizzle)   → voxpilot.db
  │   ├── GET  /{id}/stream          → persistent SSE stream (streamSSE)
  │   │     └── agent loop           → LLM (models.inference.ai.azure.com)
  │   │           ├── tool calls     → Tool framework (read_file, grep_search, etc.)
  │   │           ├── tool confirm   → pause, emit tool-confirm SSE, await approval
  │   │           └── repeat until text response or iteration cap
  │   ├── POST /{id}/messages        → enqueue user message (202)
  │   └── POST /{id}/confirm         → approve/deny tool call (202 or 409)
  ├── /api/health
  └── /* (production)                → static files from frontend/dist/
```

## Data Model

```
sessions                          messages
┌──────────────────────┐         ┌──────────────────────────────┐
│ id         TEXT PK   │◄───────┤│ session_id   TEXT FK          │
│ title      TEXT      │         │ id           INTEGER PK AI    │
│ created_at TEXT      │         │ role         TEXT              │
│ updated_at TEXT      │         │ content      TEXT              │
└──────────────────────┘         │ tool_calls   TEXT (nullable)   │  ← JSON array of {id, name, arguments}
                                 │ tool_call_id TEXT (nullable)   │  ← links tool-result to its call
                                 │ created_at   TEXT              │
                                 └──────────────────────────────┘
```

- ON DELETE CASCADE: deleting a session removes its messages.
- Session IDs are UUIDs (server-generated).
- Messages ordered by autoincrement `id` (insertion order).
- `role` is one of: `user`, `assistant`, `system`, `tool`.
- `tool_calls` is set on assistant messages that invoke tools (JSON-serialized `list[ToolCallInfo]`).
- `tool_call_id` is set on `tool`-role messages, linking the result back to its call.

## Key Conventions

- **API contract pipeline**: Backend schema changes must flow through `just generate` → exports OpenAPI spec → `openapi-typescript` generates `frontend/src/api.d.ts` → compile-time type safety on frontend API calls.
- **Auth**: GitHub token stored in plain `HttpOnly`/`SameSite=Lax` cookie (`gh_token`). No JWT. The `authMiddleware` (Hono middleware) extracts it or returns 401.
- **Config**: Environment variables with `VOXPILOT_` prefix loaded via `dotenv` in Justfile. Key settings: `dbPath` (default `voxpilot.db`), `githubClientId`, `githubClientSecret`, `workDir` (defaults to cwd — root for all tool file access), `maxAgentIterations` (default 25).
- **DB lifecycle**: `initDb()`/`closeDb()` managed via the `db.ts` module. Single `bun:sqlite` `Database` wrapped with Drizzle ORM. `getDb()` provides the Drizzle instance to routes and services. Schema changes are managed via Drizzle migrations (`backend/drizzle/`); run `just db-generate` after editing `schema.ts` to create a new migration. Migrations are applied automatically on startup via `migrate()` from `drizzle-orm/bun-sqlite/migrator`.
- **Backend layout**: `backend/src/` with routes in `routes/`, services in `services/`, schemas in `schemas/`, tools in `tools/`, DB in `db.ts`, config in `config.ts`.
- **Chat flow**: Frontend opens a browser-native `EventSource` on `GET /api/sessions/{id}/stream`. The stream replays all existing messages (including tool call/result messages), then sends a `ready` event. User messages are submitted via `POST /api/sessions/{id}/messages` (returns 202). The stream echoes the user message, then delegates to `runAgentLoop()` which streams `text-delta`, `tool-call`, `tool-result`, `done`, or `error` events. An in-memory `AsyncChannel` per session (in `services/streams.ts`) bridges the POST endpoint to the SSE handler. Auto-titles session from first message (first 50 chars). Assistant messages carry an `html` field (rendered Markdown) on `message` events (history replay) and on the `done` event (live streaming completion). During streaming, `text-delta` tokens are displayed as plain text; when `done` arrives with `html`, the frontend swaps in the rendered HTML via `innerHTML`.
- **Agent loop** (`services/agent.ts`): Async generator that yields SSE event objects. Creates an OpenAI client per request, streams the completion, accumulates tool-call deltas, executes tools via the registry, persists all messages (assistant w/ tool_calls, tool results), and loops until the LLM responds with text or hits the iteration cap. Errors from tool execution are fed back to the LLM as tool-result content so it can self-correct. On completion, the `done` event includes `html` — the full accumulated text rendered to HTML via the markdown service.
- **Markdown rendering** (`services/markdown.ts`): Server-side Markdown→HTML via a module-level `markdown-it` instance (CommonMark + tables, raw HTML disabled). Renders assistant message content to HTML in two places: history replay (`getMessagesWithTimestamps`) and the agent loop `done` event.
- **Tool framework** (`tools/`): `Tool` interface with `execute(args, workDir) → string`, `toOpenAI() → ChatCompletionToolParam`, and `resolvePath()` (validates paths stay inside `workDir`, follows symlinks via `realpath`). `ToolRegistry` maps names to instances. Tools: `read_file`, `list_directory`, `grep_search`, `glob_search`, `read_file_external` (absolute paths, requires confirmation). All are read-only; `requiresConfirmation` flag gates tools behind user approval.
- **Tool confirmation** (`services/streams.ts`, `routes/chat.ts`): Tools with `requiresConfirmation = true` pause the agent loop, emit a `tool-confirm` SSE event, and await user approval via a per-session `PromiseWithResolvers<boolean>`. The `POST /api/sessions/{id}/confirm` endpoint resolves the pending confirmation. A `pendingConfirmId` guard rejects stale or mismatched confirms (409). Timeout: 5 minutes → auto-reject.
- **Row mapping**: Drizzle ORM provides typed query results mapped to TypeScript interfaces defined in `schemas/`.
- **Tests**: `helpers.ts` has `setupTestDb()` calling `initDb(":memory:")` — every test gets a fresh in-memory DB. `mock.module("openai")` for mocking the OpenAI SDK.
- **Frontend**: SolidJS components with fine-grained signal-based reactivity. Vite build (`vite.config.ts`). Entry at `frontend/index.html` → `src/index.tsx` → `App.tsx`. State is SolidJS signals in `store.ts` (sessions list, active index, messages, streaming text, tool calls, UI state). SSE streaming uses rAF batching in `streaming.ts`: `text-delta` tokens accumulate in a plain string buffer; a `requestAnimationFrame` loop writes to the `streamingText` signal once per frame, ensuring ≤1 DOM update per frame regardless of token arrival rate. Session orchestration (switch, create, delete, prev/next) in `sessions.ts`. Touch swipe detection for mobile session navigation in `gestures.ts` (axis locking, edge exclusion for Safari). Components in `src/components/`: `ChatView` (layout), `ChatMain` (messages + input + swipe), `Sidebar` (desktop), `BottomNav` + `SessionPicker` (mobile), `MessageBubble` (uses `innerHTML` for rendered markdown on assistant messages, `.markdown-body` CSS class), `StreamingBubble` (plain text during streaming), `ToolCallBlock`. `sse.ts` is framework-agnostic (callback-based `EventSource` wrapper, unchanged from v1). Responsive layout: sidebar visible ≥768px, bottom nav + swipe on mobile <768px.
- **Production**: `just build` runs `vite build`; the Hono app auto-serves `frontend/dist/` if it exists via `serveStatic`. Single Bun process serves everything.

## Design Decisions

| Decision | Rationale |
|---|---|
| **SolidJS** | Fine-grained signals compile to direct DOM operations — same perf as hand-written code. No VDOM diffing. Scales to roadmap features (diffs, terminal, git panels) without building a bespoke framework. |
| **rAF-batched streaming** | SSE `text-delta` tokens arrive faster than 60fps. Buffering into a string and flushing via `requestAnimationFrame` collapses N tokens/frame into 1 signal write → 1 text node update. Eliminates layout thrashing. |
| **Server-side markdown** | Backend renders Markdown→HTML via `markdown-it` so the frontend doesn't need a JS markdown parser. `done` event delivers the final HTML; history replay includes it per-message. `markdown-it`'s token/rule architecture allows any render rule to be replaced without forking, enabling future custom syntax highlighting. |
| **Swipe navigation (mobile)** | Left/right swipe on the chat area navigates sessions. Touches within 25px of screen edges are ignored to avoid Safari's native back/forward gesture. Axis locking after 10px prevents unintentional swipes during vertical scroll. |
| **openapi-fetch + codegen** | Type-safe API calls; contract enforced at compile time |
| **GitHub token as Models API key** | GitHub Models accepts OAuth tokens directly; no separate key management |
| **Cookie auth (no JWT)** | Simpler; `HttpOnly` mitigates XSS; no refresh logic needed |
| **SQLite via Drizzle + bun:sqlite** | Type-safe queries, single-file DB. Drizzle is a thin headless ORM (~7.4kB). bun:sqlite is sync under the hood but queries are small (single-user app). |
| **Backend owns history** | Frontend sends only content + model; single source of truth. Stream replays full history on connect. |
| **Session-scoped SSE stream** | Browser-native `EventSource` (GET) with separate POST for messages. Simpler than POST-based SSE; supports reconnection. |
| **Agent loop as async generator** | `run_agent_loop()` yields SSE event dicts; chat route just iterates and wraps in `ServerSentEvent`. Clean separation: agent logic knows nothing about HTTP. |
| **Tool errors fed to LLM** | Tool execution failures become tool-result content, not user-facing errors. The LLM can retry or explain the failure. |
| **Path traversal guards** | `resolve()` + `relative_to(work_dir)` on every tool path argument. Symlink-aware. |
| **Auto-title from first message** | No extra LLM call; `content[:50]` is fast and sufficient |
| **OpenAI SDK for GitHub Models** | Compatible API; reuses mature SDK |
| **src layout** | TypeScript convention; Biome, tsc, and bun all resolve from src/ |
