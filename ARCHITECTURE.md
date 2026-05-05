# VoxPilot Architecture

Self-hosted web UI for AI-assisted coding. Wraps the OpenCode agent runtime with a mobile-first SolidJS frontend and a diff review system.

VoxPilot is split across three deployable components:

- **Backend** (`backend/`) — Bun-compiled API server. Headless; serves
  `/api/*`, `/oc/*` (proxied OpenCode), `/mcp`. Lives on each machine
  you want to drive through VoxPilot. Listens on loopback only when run
  alongside the tunnel sidecar.
- **Tunnel client** (`tunnel-client/`) — Tiny Go sidecar. Dials the
  gateway over outbound WSS, multiplexes inbound HTTP via `yamux`, and
  forwards each stream to the loopback backend. Reports the host's
  name + version + optional Wake-on-LAN webhook URL on register.
- **Gateway** (`gateway/`) — Go binary, distributed as a Docker image.
  Caddy fronts it for TLS. It accepts tunnel connections from backends,
  proxies browser traffic over them, serves the SolidJS frontend
  bundle (embedded), hosts the picker UI at `/`, and exposes a wake
  endpoint that POSTs to per-host webhook URLs.

The frontend bundle ships **only** with the gateway image. Backends are
pure API servers.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Bun 1.3 |
| Backend | TypeScript 5.9, Hono 4, Drizzle ORM, SQLite (bun:sqlite, WAL) |
| Frontend | SolidJS 1.9, TypeScript 5.7, Vite 7 |
| Agent | OpenCode SDK (`@opencode-ai/sdk`) -- embedded server, proxied at `/oc/*` |
| Tools | MCP server (`@modelcontextprotocol/sdk`) -- exposes `show_diff` to the agent |
| Diff engine | `prettier` (formatting) + `diff` (line diffing) |
| Gateway | Go 1.24, `coder/websocket`, `hashicorp/yamux`, `embed.FS` for assets |
| Tunnel | Go 1.24 sidecar, mirrors gateway's transport |
| Linter | Biome (shared config at repo root `biome.json`) |
| Task runner | `just` (Justfile) |
| Icons | `lucide-solid` |
| Markdown | `markdown-it` (both backend and frontend) |

## Project Layout

```
backend/
  src/
    index.ts              Entry point: Hono app, OpenCode server, proxy. Headless API server.
    db.ts                 SQLite + Drizzle init, auto-migration on startup
    schema.ts             Drizzle schema: diff_entries, diff_entry_files
    proxy.ts              Generic HTTP request proxy (used for /oc/*)
    mcp.ts                MCP server with show_diff tool (Streamable HTTP transport)
    routes/
      review.ts           GET /api/review/ref-diff/cache/:id, POST /api/review/ref-diff
      config.ts           GET /api/config (wakeUrl)
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
    index.tsx             SolidJS render entry. Branches on PICKER_MODE: picker
                          page at gateway root, full app under /backends/<name>/.
    backend-base.ts       Runtime path detection: BACKEND_PREFIX, FRONTEND_VERSION,
                          PICKER_MODE, backendStorageKey()
    Picker.tsx            Standalone picker page (lists backends, wake button,
                          version-skew badge). Loaded only in PICKER_MODE.
    App.tsx               ErrorBoundary wrapper, renders ChatView + ToastContainer
    store.ts              All reactive state (signals, stores, resources, memos)
    api-client.ts         OpenCode SDK client (base URL: <BACKEND_PREFIX>/oc)
    rpc.ts                Hono RPC client (base URL: <BACKEND_PREFIX>)
    streaming.ts          rAF-batched event handler, optimistic messages
    navigation.ts         Session orchestration (switch, create, delete)
    ...                   (other modules unchanged)

gateway/
  main.go                 HTTP server, routing
  registry.go             In-memory + on-disk instance registry
  tunnel.go               WS upgrade, yamux session setup, control stream parsing
  proxy.go                Reverse proxy with yamux Transport, /backends/<name>/(api|oc|mcp)
  wake.go                 POST /api/gateway/wake/<name> -> per-host webhook
  static.go               Embedded frontend with SPA fallback
  Dockerfile              Multi-stage build (frontend npm + gateway go + distroless)
  static/                 Placeholder; populated by Vite build during Docker build

tunnel-client/
  main.go                 Entry point + reconnect loop with exponential backoff
  client.go               WS dial, yamux client, hello + heartbeat on control stream
  forward.go              Per-stream HTTP server backed by a one-shot net.Listener

packaging/
  README.md               Backend host install/upgrade/uninstall (in tarball)
  systemd/
    voxpilot.service      Backend (Bun binary)
    voxpilot-tunnel.service  Tunnel sidecar (BindsTo voxpilot.service)

scripts/build-release.sh  Backend + tunnel-client tarball
.github/workflows/
  release.yml             Tarball + ghcr.io/.../voxpilot-gateway image

DESIGN_SYSTEM.md          frontend/DESIGN_SYSTEM.md - CSS design system reference
Justfile                  just install/dev/test/lint/typecheck/format/build/check
biome.json                Shared Biome config (backend + frontend)
```

## Request Flow

```
Browser (SolidJS, served by gateway at one TLS origin)
  │
  ▼
Caddy (TLS) ──► gateway container
  ├── GET /                              ──► picker page (HTML+JS bundle)
  ├── GET /assets/*, /icon-*.png         ──► embedded static assets
  ├── GET /api/gateway/instances         ──► registry snapshot (for picker)
  ├── POST /api/gateway/wake/<name>      ──► HTTP POST to that backend's wake_url
  ├── GET /api/gateway/tunnel            ──► WS upgrade (tunnel-client connects here)
  └── ANY /backends/<name>/(api|oc|mcp)/...
       │
       ▼  yamux stream (one per request) over the persistent WS tunnel
       voxpilot-tunnel (backend host)
       │
       ▼  loopback HTTP
       voxpilot backend (127.0.0.1:8000)
       ├── /api/review/*    -> diff cache (SQLite)
       ├── /api/config      -> wakeUrl etc.
       ├── /oc/*            -> proxied to embedded OpenCode server
       ├── /mcp             -> show_diff tool (called by OpenCode)
       │
       OpenCode (embedded) ──► MCP back-call: POST 127.0.0.1:8000/mcp/show_diff
                                        ├── git diff
                                        ├── cache to SQLite
                                        └── return [ref:UUID] stat summary
```

The frontend reads its `BACKEND_PREFIX` from `window.location.pathname`
at module load (`backend-base.ts`) and configures both API clients
accordingly. Switching backends is a full page navigation, not SPA
routing — the SSE pump and store init are bound to one backend per
page load.

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

### Backend (`voxpilot`)

| Variable | Default | Purpose |
|---|---|---|
| VOXPILOT_PORT | 8000 | HTTP server port (loopback when behind a tunnel) |
| VOXPILOT_OC_PORT | 0 (auto-pick) | Embedded OpenCode server port |
| VOXPILOT_DB_PATH | voxpilot.db | SQLite database path |
| VOXPILOT_API_TARGET | http://127.0.0.1:8000 | Vite dev proxy target (frontend dev only) |

### Tunnel client (`voxpilot-tunnel`)

| Variable | Default | Purpose |
|---|---|---|
| VOXPILOT_GATEWAY_URL | _required_ | `wss://gateway/api/gateway/tunnel` |
| VOXPILOT_GATEWAY_TOKEN | _required_ | Shared secret with the gateway |
| VOXPILOT_INSTANCE_NAME | hostname | URL slug at `/backends/<name>/` |
| VOXPILOT_LOCAL_URL | http://127.0.0.1:8000 | Backend address |
| VOXPILOT_WAKE_URL | (unset) | Wake-on-LAN webhook URL |

### Gateway (`voxpilot-gateway`)

| Variable | Default | Purpose |
|---|---|---|
| VPGW_BIND | :8080 | HTTP listen address |
| VPGW_TUNNEL_TOKEN | _required_ | Shared secret with tunnel clients |
| VPGW_DATA_DIR | (unset) | Persist registry to `<dir>/instances.json` |
| VPGW_HEARTBEAT_TIMEOUT | 60s | Mark instance offline after this gap |
| VPGW_FRONTEND_DIR | (unset) | Override the embedded frontend (dev) |

## Key Patterns

**Type-safe RPC**: Backend exports `AppType` from Hono. Frontend imports via `@backend/*` tsconfig alias, uses `hc<AppType>()`. No codegen. Schema change = compile error everywhere.

**Two API clients on frontend**: OpenCode SDK client for agent features (sessions, messages, permissions, questions, events). Hono RPC client for VoxPilot-specific endpoints (diff review).

**rAF-batched streaming**: SSE text-delta tokens accumulate in a plain string; a `requestAnimationFrame` loop flushes to the SolidJS store once per frame. Collapses N tokens into 1 DOM update.

**Optimistic messages**: User message appears immediately with id `__optimistic__`. Replaced by real message on SSE confirmation, or removed on send failure.

**MCP tool flow**: OpenCode agent calls `show_diff` via MCP. The tool runs git diff, stores full file contents in SQLite, returns a stat summary with `[ref:UUID]` to the LLM. The frontend's `ChangesetCard` detects `[ref:UUID]` in tool output, fetches the cache, and renders an interactive diff viewer.

**Git ref handling**: `getFileAtRef()` supports three modes: `WORKTREE` (read from disk), `INDEX` (git show :path), real refs (git show ref:path). Refs are validated against `SAFE_REF_PATTERN` to prevent shell injection.

**No auth on the app itself**: Single-user self-hosted. The gateway exposes the app over TLS and any browser that can reach the TLS endpoint can use it. **The tunnel WebSocket endpoint is the one auth boundary** — it requires `VPGW_TUNNEL_TOKEN`.

**Multi-backend, single bundle**: One frontend bundle is served by the gateway. It detects whether it's at the picker (`/`) or scoped to a backend (`/backends/<name>/...`) by inspecting `window.location.pathname` at module load. Switching backends is a full page navigation — much simpler than threading a backend parameter through every call site, given the codebase's heavy use of module-level singletons.

**No client-side router**: Single-view chat app. Active session tracked in URL hash (within a backend's path).

**Mobile-first**: No media breakpoints. Touch swipe for session navigation. Safe area insets for iOS. See `frontend/DESIGN_SYSTEM.md` for CSS conventions.

## Commands

```
just install          # bun install (backend) + npm install (frontend)
just dev              # Run both servers concurrently (backend on :8000, Vite on :3000)
just dev-backend      # bun run --hot backend/src/index.ts
just dev-frontend     # cd frontend && npm run dev (Vite proxies /oc and /api to :8000)
just test             # cd backend && bun test
just lint             # Biome check (both) + tsc --noEmit (frontend)
just typecheck        # tsc --noEmit (both)
just format           # Biome --write (both)
just build            # vite build
just check            # install + lint + typecheck + test
```

The gateway and tunnel-client are built separately:

```
( cd gateway && go build ./... )
( cd tunnel-client && go build ./... )
```

For a full release, see `scripts/build-release.sh` (backend tarball)
and `gateway/Dockerfile` (gateway image).
