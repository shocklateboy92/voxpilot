# VoxPilot — Copilot Instructions

VoxPilot is a **self-hosted, web-based AI coding assistant** built with a TypeScript/Bun backend and a SolidJS frontend. It enables remote development from mobile devices by exposing a local web UI over the network.

## Repository Structure

```
backend/          TypeScript + Bun backend (Hono, Drizzle ORM, SQLite)
  src/
    config.ts     Environment variable configuration (VOXPILOT_* prefix)
    db.ts         SQLite database initialization, migrations, getDb()
    index.ts      Hono app entry point, server startup
    schema.ts     Drizzle ORM schema (sessions, messages tables)
    middleware/   Auth middleware (GitHub token cookie)
    routes/       Hono route handlers (auth, sessions/chat)
    schemas/      TypeScript interfaces for DB row types
    services/     Business logic (agent loop, markdown, SSE streams)
    tools/        Tool framework (read_file, grep_search, etc.)
  tests/          Bun tests with in-memory SQLite
  drizzle/        Auto-generated Drizzle migration SQL files
frontend/         SolidJS + Vite frontend
  src/
    components/   UI components (ChatView, MessageBubble, Sidebar, etc.)
    store.ts      SolidJS signals for app state
    sessions.ts   Session management logic
    streaming.ts  rAF-batched SSE text-delta handling
    gestures.ts   Touch swipe detection for mobile
    sse.ts        Framework-agnostic EventSource wrapper
Justfile          Task runner recipes (install, dev, test, lint, build)
ARCHITECTURE.md   Detailed architecture documentation
```

## Development Commands

All commands are run from the **repository root** using `just`:

```bash
just install       # Install all dependencies (bun + npm)
just dev-backend   # Run backend dev server (hot reload)
just dev-frontend  # Run frontend dev server (Vite)
just test          # Run backend tests (bun test)
just lint          # Lint backend (Biome) + typecheck frontend (tsc)
just typecheck     # Type-check backend and frontend (tsc --noEmit)
just format        # Auto-fix formatting (Biome --write)
just build         # Build frontend for production (vite build)
just check         # Full CI: install + lint + typecheck + test
```

Individual commands (from their directories):

```bash
# Backend
cd backend && bun install
cd backend && bun test
cd backend && bunx tsc --noEmit
cd backend && bunx @biomejs/biome check --write src tests

# Frontend
cd frontend && npm install
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

## Tech Stack

- **Backend**: TypeScript 5.9, Bun 1.3, Hono 4, Zod v4, Drizzle ORM, `markdown-it`, Biome linter
- **Frontend**: SolidJS 1.9 + TypeScript 5.7, Vite
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM (WAL mode, foreign keys enabled)
- **Tests**: `bun test` with `mock.module()`, in-memory SQLite via `initDb(":memory:")`

## Coding Standards

### TypeScript

- **Never** use the null forgiving operator (`!`)
- **Never** use `any`; use proper types or `unknown`
- Use Zod v4 schemas for runtime validation (import from `"zod/v4"`)

### Backend Patterns

- Routes live in `backend/src/routes/`, services in `backend/src/services/`
- Use `getDb()` from `db.ts` to access the Drizzle instance in route handlers
- Config values are accessed via `getConfig()` from `config.ts` (env vars with `VOXPILOT_` prefix)
- Auth is enforced via `authMiddleware` which reads the `gh_token` `HttpOnly` cookie
- Tool implementations go in `backend/src/tools/` and must implement the `Tool` interface from `base.ts`
- Schema changes: edit `schema.ts`, run `just db-generate` to create a migration in `backend/drizzle/`

### Dependencies

- Always use the latest version of any new dependency introduced
- Backend uses `bun install`; frontend uses `npm install`

### Testing

- Each test file calls `setupTestDb()` from `helpers.ts` to get a fresh in-memory database
- Mock the OpenAI SDK with `mock.module("openai")` when testing the agent loop
- Test files live in `backend/tests/`

### Frontend Patterns

- Use SolidJS signals and stores from `store.ts` for shared state
- The frontend talks to the backend via `hc<AppType>()` (Hono RPC client) — no manual fetch calls
- The `AppType` is imported via the `@backend/*` tsconfig path alias
- Use `innerHTML` only on assistant message bubbles (server-rendered HTML from `markdown-it`)

## Key Conventions

- **API contract**: Backend exports `AppType`; frontend imports and uses `hc<AppType>()` for type-safe RPC. No codegen needed.
- **Auth**: GitHub OAuth token stored as `HttpOnly` cookie (`gh_token`). No JWT.
- **SSE streaming**: Frontend opens `EventSource` on `GET /api/sessions/{id}/stream`; messages sent via `POST /api/sessions/{id}/messages`.
- **Agent loop**: `runAgentLoop()` in `services/agent.ts` is an async generator yielding SSE event objects.
- **Tool confirmation**: Tools with `requiresConfirmation = true` pause execution and await `POST /api/sessions/{id}/confirm`.
- **Path safety**: All tool file access uses `resolvePath()` which validates paths stay inside `workDir`.
- **Markdown**: Server-side rendering via `markdown-it`; the `done` SSE event carries pre-rendered HTML.
