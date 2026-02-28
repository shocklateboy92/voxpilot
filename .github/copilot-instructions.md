# VoxPilot -- Copilot Instructions

VoxPilot is a **self-hosted, web-based AI coding assistant** built with a TypeScript/Bun backend and a SolidJS frontend. It wraps the OpenCode agent runtime, adding a mobile-first web UI and an interactive diff review system.

See [ARCHITECTURE.md](../ARCHITECTURE.md) for full architecture details.

## Repository Structure

```
backend/src/
  index.ts          Hono app, OpenCode server startup, /oc/* proxy, static serving
  db.ts             SQLite + Drizzle, auto-migration
  schema.ts         Drizzle schema (diff_entries, diff_entry_files)
  proxy.ts          HTTP proxy helper
  mcp.ts            MCP server with show_diff tool
  routes/review.ts  Diff review API endpoints
  schemas/api.ts    Zod v4 request schemas
  services/         git-utils, format-diff, diff-render, diff-types
  tests/            format-diff + diff-render tests
frontend/src/
  store.ts          All reactive state (signals, stores, resources)
  api-client.ts     OpenCode SDK client wrapper
  rpc.ts            Hono RPC client (hc<AppType>)
  sse.ts            Event stream subscription
  streaming.ts      rAF-batched event handler, optimistic messages
  sessions.ts       Session orchestration
  gestures.ts       Touch swipe detection
  components/       15 SolidJS components (see ARCHITECTURE.md for full list)
  style.css         Single stylesheet with CSS custom properties
  DESIGN_SYSTEM.md  CSS conventions and design tokens
```

## Development Commands

All commands run from the repository root using `just`:

```bash
just install       # bun install (backend) + npm install (frontend)
just dev           # Run both servers (backend :8000, frontend :3000)
just test          # bun test (backend)
just lint          # Biome check + tsc --noEmit
just typecheck     # tsc --noEmit (both packages)
just format        # Biome --write
just build         # vite build (frontend)
just check         # install + lint + typecheck + test
```

## Tech Stack

- **Backend**: TypeScript 5.9, Bun 1.3, Hono 4, Zod v4, Drizzle ORM, `markdown-it`, Biome
- **Frontend**: SolidJS 1.9, TypeScript 5.7, Vite 7, `lucide-solid`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM (WAL mode, foreign keys)
- **Agent**: OpenCode SDK (`@opencode-ai/sdk`) -- embedded server proxied at `/oc/*`
- **Tools**: MCP server (`@modelcontextprotocol/sdk`) -- exposes `show_diff`
- **Tests**: `bun test`

## Coding Standards

### TypeScript

- **Never** use the null forgiving operator (`!`)
- **Never** use `any`; use proper types or `unknown`
- Use Zod v4 schemas for runtime validation (import from `"zod/v4"`)
- Prefer type narrowing over casting

### Backend Patterns

- Routes in `backend/src/routes/`, services in `backend/src/services/`
- Use `getDb()` from `db.ts` for the Drizzle instance
- Schema changes: edit `schema.ts`, run `bunx drizzle-kit generate`
- No authentication -- single-user self-hosted, all routes public
- Services are pure/async functions, no classes or DI
- Git operations go through `runGit()` in `git-utils.ts`
- Refs validated against `SAFE_REF_PATTERN` to prevent injection

### Frontend Patterns

- SolidJS signals and stores from `store.ts` for all shared state
- Two API clients: OpenCode SDK client (`api-client.ts`) for agent features, Hono RPC client (`rpc.ts`) for VoxPilot endpoints
- `AppType` imported via `@backend/*` tsconfig path alias for type-safe RPC
- `innerHTML` only on assistant message bubbles (markdown-it rendered HTML)
- Mobile-first, no media breakpoints -- see `frontend/DESIGN_SYSTEM.md`
- No client-side router; active session tracked in URL hash

### Dependencies

- Always use the latest version of any new dependency
- Backend: `bun install` / Frontend: `npm install`

### Testing

- Tests in `backend/tests/`
- `bun test` runner

## Key Conventions

- **Type-safe RPC**: Backend exports `AppType`; frontend uses `hc<AppType>()`. No codegen.
- **Streaming**: SSE via OpenCode SDK event stream. Frontend uses rAF batching for text tokens.
- **Diff review flow**: MCP `show_diff` tool caches diff data in SQLite, returns `[ref:UUID]`. Frontend `ChangesetCard` detects the UUID, fetches cache, renders interactive diff via `ReviewOverlay`.
- **Optimistic UI**: User messages appear immediately with id `__optimistic__`, replaced on confirmation.
