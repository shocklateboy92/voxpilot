# VoxPilot — Architecture Document

## Goal

VoxPilot is a **self-hosted, web-based AI coding assistant** — an alternative to cloud-hosted tools like Claude Code and GitHub Copilot. It runs on your local machine and exposes a web UI, enabling **remote development from mobile devices** (phone, tablet) by connecting to the local instance over the network.

## Current State

**Agentic coding assistant** powered by GPT-4o (etc.) via the **GitHub Models API**. Users authenticate with GitHub OAuth; their access token is reused as the API key for inference. The LLM can call read-only tools (read files, search code, list directories) through an agentic loop that executes tools and feeds results back until the task is done. Conversations (including tool call/result messages) are persisted in SQLite.

## Stack

- **Backend**: Python 3.13, FastAPI, Pydantic v2, `uv`, Pyright (strict), Ruff
- **Frontend**: Vanilla TypeScript 5.7 (no framework), esbuild, `openapi-fetch`
- **Database**: SQLite via `aiosqlite` (WAL mode, foreign keys enabled)
- **Task runner**: `just` (see Justfile for all recipes)
- **Tests**: pytest-asyncio with `httpx.ASGITransport` (no live server), in-memory SQLite

## Architecture

```
Browser (vanilla TS SPA)
  │  openapi-fetch, EventSource, cookies
  │
  ▼  HTTP/JSON + SSE
FastAPI (uvicorn :8000)
  ├── /api/auth/*                    → GitHub OAuth (httpx)     → github.com
  ├── /api/sessions/*                → Session CRUD (aiosqlite) → voxpilot.db
  │   ├── GET  /{id}/stream          → persistent SSE stream
  │   │     └── agent loop           → LLM (models.inference.ai.azure.com)
  │   │           ├── tool calls     → Tool framework (read_file, grep_search, etc.)
  │   │           └── repeat until text response or iteration cap
  │   └── POST /{id}/messages        → enqueue user message (202)
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
- **Auth**: GitHub token stored in plain `HttpOnly`/`SameSite=Lax` cookie (`gh_token`). No JWT. The `GitHubToken` dependency (`dependencies.py`) extracts it or raises 401.
- **Config**: `pydantic-settings` with `VOXPILOT_` env prefix. `.env` auto-loaded by Justfile. Key settings: `db_path` (default `voxpilot.db`), `github_client_id`, `github_client_secret`, `work_dir` (Path, defaults to cwd — root for all tool file access), `max_agent_iterations` (default 25).
- **DB lifecycle**: `init_db()`/`close_db()` managed via FastAPI `lifespan`. Single shared `aiosqlite.Connection` (sufficient for single-user). `get_db()` dependency provides it to routes.
- **Backend layout**: src layout (`backend/src/voxpilot/`). Routes in `api/routes/`, services in `services/`, schemas in `models/schemas.py`, DB in `db.py`.
- **Chat flow**: Frontend opens a browser-native `EventSource` on `GET /api/sessions/{id}/stream`. The stream replays all existing messages (including tool call/result messages), then sends a `ready` event. User messages are submitted via `POST /api/sessions/{id}/messages` (returns 202). The stream echoes the user message, then delegates to `run_agent_loop()` which streams `text-delta`, `tool-call`, `tool-result`, `done`, or `error` events. An in-memory `asyncio.Queue` per session (in `services/streams.py`) bridges the POST endpoint to the SSE generator. Auto-titles session from first message (first 50 chars).
- **Agent loop** (`services/agent.py`): Async generator that yields SSE event dicts. Creates an OpenAI client per request, streams the completion, accumulates tool-call deltas, executes tools via the registry, persists all messages (assistant w/ tool_calls, tool results), and loops until the LLM responds with text or hits the iteration cap. Errors from tool execution are fed back to the LLM as tool-result content so it can self-correct.
- **Tool framework** (`services/tools/`): Abstract `Tool` base class with `execute(arguments, work_dir) → str`, `to_openai_tool() → ChatCompletionToolParam`, and `_resolve_path()` (validates paths stay inside `work_dir`). `ToolRegistry` maps names to instances. Tools: `read_file`, `list_directory`, `grep_search`, `glob_search`. All are read-only; `requires_confirmation` hook exists for future write tools.
- **Row mapping**: `aiosqlite.Row` (dict-like access) → Pydantic models via explicit constructors in `services/sessions.py`. ~15 lines total, fully typed.
- **Frontend**: `main.ts` manages session sidebar + chat area. No in-memory message array; state lives in the DB. History replayed via the session stream on connect; `sse.ts` wraps `EventSource` and exposes typed callbacks (`onMessage`, `onTextDelta`, `onDone`, `onError`, `onToolCall`, `onToolResult`). Tool calls rendered as collapsible `<details>` blocks; tool results appended inside matched blocks via `data-tool-call-id`.
- **Production**: `just build` bundles frontend; `create_app()` auto-mounts `frontend/dist/` if it exists. Single uvicorn process serves everything.
- **Tests**: `conftest.py` has `autouse` fixture calling `init_db(":memory:")` — every test gets a fresh in-memory DB.

## Design Decisions

| Decision | Rationale |
|---|---|
| **No frontend framework** | Minimal scope; vanilla TS keeps bundle tiny and avoids churn |
| **openapi-fetch + codegen** | Type-safe API calls; contract enforced at compile time |
| **GitHub token as Models API key** | GitHub Models accepts OAuth tokens directly; no separate key management |
| **Cookie auth (no JWT)** | Simpler; `HttpOnly` mitigates XSS; no refresh logic needed |
| **SQLite via raw aiosqlite** | Async-safe, single-file DB, no ORM. SQLModel rejected for poor Pyright strict compat |
| **Backend owns history** | Frontend sends only content + model; single source of truth. Stream replays full history on connect. |
| **Session-scoped SSE stream** | Browser-native `EventSource` (GET) with separate POST for messages. Simpler than POST-based SSE; supports reconnection. |
| **Agent loop as async generator** | `run_agent_loop()` yields SSE event dicts; chat route just iterates and wraps in `ServerSentEvent`. Clean separation: agent logic knows nothing about HTTP. |
| **Tool errors fed to LLM** | Tool execution failures become tool-result content, not user-facing errors. The LLM can retry or explain the failure. |
| **Path traversal guards** | `resolve()` + `relative_to(work_dir)` on every tool path argument. Symlink-aware. |
| **Auto-title from first message** | No extra LLM call; `content[:50]` is fast and sufficient |
| **OpenAI SDK for GitHub Models** | Compatible API; reuses mature SDK |
| **src layout** | Python packaging best practice; prevents root imports |
