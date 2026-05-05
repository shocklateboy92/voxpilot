# VoxPilot Architecture

Self-hosted web UI for AI-assisted coding. Wraps the OpenCode agent runtime with a mobile-first SolidJS frontend and a diff review system.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Bun 1.3 |
| Backend | TypeScript 5.9, Hono 4, Drizzle ORM, SQLite (bun:sqlite, WAL) |
| Frontend | SolidJS 1.9, TypeScript 5.7, Vite 7 |
| Agent | OpenCode SDK (`@opencode-ai/sdk`) -- embedded server, proxied at `/oc/*` |
| Tools | MCP server (`@modelcontextprotocol/sdk`) -- exposes `show_diff` to the agent |
| Diff engine | `prettier` (formatting) + `diff` (line diffing) |
| Linter | Biome (shared config at repo root `biome.json`) |
| Task runner | `just` (Justfile) |
| Icons | `lucide-solid` |
| Markdown | `markdown-it` (both backend and frontend) |

## Project Layout

```
backend/
  src/
    index.ts              Entry point: Hono app, OpenCode server, proxy, static serving
    db.ts                 SQLite + Drizzle init, auto-migration on startup
    schema.ts             Drizzle schema: diff_entries, diff_entry_files
    proxy.ts              Generic HTTP request proxy (used for /oc/*)
    mcp.ts                MCP server with show_diff tool (Streamable HTTP transport)
    routes/
      review.ts           GET /api/review/ref-diff/cache/:id, POST /api/review/ref-diff
    schemas/
      api.ts              Zod v4 request schemas (RefDiffRequest)
    services/
      git-utils.ts        runGit(), ensureGitRepo(), getFileAtRef(ref, path)
      format-diff.ts      Prettier formatting + line diff + hunk building
      diff-render.ts      Diff HTML rendering (hunk view + full-file view)
      diff-types.ts       DiffLine, DiffHunk interfaces
  tests/
    format-diff.test.ts   Diff formatting + hunk building tests
    diff-render.test.ts   HTML rendering tests
  drizzle/                Migration SQL files (auto-applied on startup)
frontend/
  src/
    index.tsx             SolidJS render entry, global error handler
    App.tsx               ErrorBoundary wrapper, renders ChatView + ToastContainer
    store.ts              All reactive state (signals, stores, resources, memos)
    api-client.ts         OpenCode SDK client wrapper (sessions, messages, permissions, etc.)
    rpc.ts                Hono RPC client (hc<AppType>) for VoxPilot-specific endpoints
    sse.ts                OpenCode event stream subscription
    streaming.ts          rAF-batched event handler, optimistic messages
    sessions.ts           Session orchestration (switch, create, delete, navigate)
    gestures.ts           Touch swipe detection (axis locking, edge exclusion)
    markdown.ts           markdown-it instance
    review-state.ts       localStorage-backed review state (viewed files, comments)
    style.css             Single stylesheet, CSS custom properties, dark-first
    components/
      ChatView.tsx        Main layout container
      ChatMain.tsx        Scrollable message list + swipe gestures
      ChatInput.tsx       Textarea + send, Enter to submit, auto-resize
      MessageBubble.tsx   User/assistant messages, markdown, tool parts, streaming cursor
      ToolPartBlock.tsx   Collapsible tool call display with status icons
      ToolConfirmBlock.tsx  Permission prompt (allow once / always / reject)
      QuestionBlock.tsx   AI question prompt with option chips + custom input
      ChangesetCard.tsx   Inline diff card, extracts [ref:UUID], opens ReviewOverlay
      ReviewOverlay.tsx   Fullscreen diff viewer, measures width for printWidth
      StatusBar.tsx       Floating bar: git branch + context usage
      ContextUsageBar.tsx Token usage indicator vs model context limit
      AgentPicker.tsx     Segmented control for agent selection (persisted to localStorage)
      BottomNav.tsx       Session title + new chat button
      SessionPicker.tsx   Bottom sheet overlay listing all sessions
      ToastContainer.tsx  Auto-dismissing error toasts
  DESIGN_SYSTEM.md        CSS design system reference (kept up to date separately)
Justfile                  just install/dev/test/lint/typecheck/format/build/check
biome.json                Shared Biome config (backend + frontend)
.env.example              VOXPILOT_LLM_BASE_URL, VOXPILOT_LLM_API_KEY, VOXPILOT_LLM_DEFAULT_MODEL
```

## Request Flow

```
Browser (SolidJS)
  ├── hc<AppType>() ───► POST /api/review/ref-diff     ──► format-diff service ──► Prettier + diff
  │                      GET  /api/review/ref-diff/cache/:id ──► SQLite lookup
  │
  ├── OpenCode SDK  ───► ALL /oc/*  ───► proxy ───► OpenCode server (auto-picked port)
  │   client                                          ├── sessions, messages, prompts
  │                                                   ├── permissions, questions
  │                                                   ├── SSE event stream
  │                                                   └── calls MCP tools ──► POST /mcp
  │                                                                            └── show_diff
  │                                                                                 ├── git diff
  │                                                                                 ├── cache to SQLite
  │                                                                                 └── return stat summary
  └── static assets ──► /* serveStatic (production)
```

## Data

VoxPilot's SQLite database (`VOXPILOT_DB_PATH`, default `voxpilot.db`) stores only diff cache data. Session/message data is managed entirely by the OpenCode server (separate storage).

### Tables

**diff_entries** -- one row per diff invocation

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| from_ref | TEXT | e.g. HEAD, INDEX, SHA |
| to_ref | TEXT | e.g. WORKTREE, INDEX, SHA |
| resolved_from | TEXT | Resolved SHA or synthetic name |
| resolved_to | TEXT | Resolved SHA or synthetic name |
| repo_root | TEXT | Absolute path |
| path | TEXT? | Optional path filter |
| created_at | INTEGER | Timestamp |

**diff_entry_files** -- per-file content for each diff entry

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| entry_id | TEXT FK | CASCADE DELETE to diff_entries |
| file_path | TEXT | Relative path |
| additions | INTEGER | |
| deletions | INTEGER | |
| before_content | TEXT | Full file at from_ref |
| after_content | TEXT | Full file at to_ref |

Schema changes: edit `schema.ts`, run `bunx drizzle-kit generate` to create migration SQL.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| VOXPILOT_PORT | 8000 | HTTP server port |
| VOXPILOT_OC_PORT | 0 (auto-pick) | Embedded OpenCode server port |
| VOXPILOT_DB_PATH | voxpilot.db | SQLite database path |
| VOXPILOT_LLM_BASE_URL | http://localhost:11434/v1 | OpenAI-compatible inference URL |
| VOXPILOT_LLM_API_KEY | ollama | API key for inference |
| VOXPILOT_LLM_DEFAULT_MODEL | qwen3-coder:30b | Default model |
| VOXPILOT_API_TARGET | http://127.0.0.1:8000 | Vite dev proxy target |

## Key Patterns

**Type-safe RPC**: Backend exports `AppType` from Hono. Frontend imports via `@backend/*` tsconfig alias, uses `hc<AppType>()`. No codegen. Schema change = compile error everywhere.

**Two API clients on frontend**: OpenCode SDK client for agent features (sessions, messages, permissions, questions, events). Hono RPC client for VoxPilot-specific endpoints (diff review).

**rAF-batched streaming**: SSE text-delta tokens accumulate in a plain string; a `requestAnimationFrame` loop flushes to the SolidJS store once per frame. Collapses N tokens into 1 DOM update.

**Optimistic messages**: User message appears immediately with id `__optimistic__`. Replaced by real message on SSE confirmation, or removed on send failure.

**MCP tool flow**: OpenCode agent calls `show_diff` via MCP. The tool runs git diff, stores full file contents in SQLite, returns a stat summary with `[ref:UUID]` to the LLM. The frontend's `ChangesetCard` detects `[ref:UUID]` in tool output, fetches the cache, and renders an interactive diff viewer.

**Git ref handling**: `getFileAtRef()` supports three modes: `WORKTREE` (read from disk), `INDEX` (git show :path), real refs (git show ref:path). Refs are validated against `SAFE_REF_PATTERN` to prevent shell injection.

**No auth**: Single-user self-hosted. All routes public.

**No client-side router**: Single-view chat app. Active session tracked in URL hash.

**Mobile-first**: No media breakpoints. Touch swipe for session navigation. Safe area insets for iOS. See `frontend/DESIGN_SYSTEM.md` for CSS conventions.

## Commands

```
just install          # bun install (backend) + npm install (frontend)
just dev              # Run both servers concurrently
just dev-backend      # bun run --hot backend/src/index.ts
just dev-frontend     # cd frontend && npm run dev (Vite on :3000, proxies /oc and /api to :8000)
just test             # cd backend && bun test
just lint             # Biome check (both) + tsc --noEmit (frontend)
just typecheck        # tsc --noEmit (both)
just format           # Biome --write (both)
just build            # vite build
just build-static     # vite build + copy dist to backend/static/
just check            # install + lint + typecheck + test
```
