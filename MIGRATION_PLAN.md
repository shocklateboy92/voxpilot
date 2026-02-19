# VoxPilot — Python → TypeScript Migration Plan

## Goal

Migrate the backend from Python 3.13 / FastAPI / aiosqlite to **TypeScript / Bun / Hono**, unifying the stack into a single language across frontend and backend. The migration must preserve all existing behavior, API contract, and test coverage.

## Progress

- [x] Phase 1 — Scaffold & Infrastructure (complete)
- [x] Phase 2 — Schemas & Middleware (complete)
- [x] Phase 3 — Health & Auth Routes (complete)
- [x] Phase 4 — Session CRUD (complete)
- [x] Phase 5 — Markdown Service (complete)
- [x] Phase 6 — Tool Framework
- [x] Phase 7 — Stream Registry & Confirmation
- [x] Phase 8 — Agent Loop
- [x] Phase 9 — Chat Routes (SSE)
- [x] Phase 10 — Integration & Cleanup

## Stack Mapping

| Role | Current (Python) | Target (TypeScript) |
|---|---|---|
| Runtime | Python 3.13 | **Bun** |
| Framework | FastAPI | **Hono** |
| Validation / Schemas | Pydantic v2 | **Zod** + `@hono/zod-openapi` |
| ORM / Database | raw `aiosqlite` | **Drizzle ORM** + `bun:sqlite` |
| Migrations | manual DDL in `db.py` | **drizzle-kit** (generate & push) |
| HTTP client | `httpx` | `fetch` (built-in) |
| LLM SDK | `openai` (Python) | `openai` (npm) |
| SSE | `sse-starlette` | Hono streaming helper / `ReadableStream` |
| Markdown | `markdown-it-py` | `markdown-it` (the original JS library) |
| Config | `pydantic-settings` | `Bun.env` + Zod schema |
| Testing | `pytest-asyncio` + `httpx` | `bun test` (Jest-compatible) |
| Lint + Format | Ruff + Pyright | **Biome** + `tsc --noEmit` |
| OpenAPI codegen | `export_openapi.py` + `openapi-typescript` | `@hono/zod-openapi` auto-generates spec |
| Package manager | `uv` | `bun` (for both frontend & backend) |
| Task runner | `just` (retained) | `just` (retained, updated recipes) |

## New Directory Layout

```
voxpilot/
├── Justfile                        # updated recipes
├── biome.json                      # lint + format config (replaces ruff/pyright)
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── drizzle.config.ts           # drizzle-kit config
│   ├── drizzle/                    # generated SQL migrations (drizzle-kit)
│   │   └── 0000_initial.sql
│   ├── src/
│   │   ├── index.ts                # entrypoint: create app, listen
│   │   ├── config.ts               # Zod env schema
│   │   ├── db.ts                   # Drizzle instance + schema
│   │   ├── schema.ts               # Drizzle table definitions
│   │   ├── middleware/
│   │   │   └── auth.ts             # GitHubToken middleware
│   │   ├── routes/
│   │   │   ├── health.ts
│   │   │   ├── auth.ts
│   │   │   ├── sessions.ts
│   │   │   └── chat.ts
│   │   ├── services/
│   │   │   ├── agent.ts            # agentic loop (async generator)
│   │   │   ├── github.ts           # OAuth helpers
│   │   │   ├── markdown.ts         # markdown-it wrapper
│   │   │   ├── sessions.ts         # session/message persistence
│   │   │   └── streams.ts          # SessionStreamRegistry
│   │   ├── tools/
│   │   │   ├── base.ts             # Tool interface
│   │   │   ├── registry.ts         # ToolRegistry
│   │   │   ├── read-file.ts
│   │   │   ├── read-file-external.ts
│   │   │   ├── list-directory.ts
│   │   │   ├── grep-search.ts
│   │   │   └── glob-search.ts
│   │   └── schemas/
│   │       ├── api.ts              # Zod schemas for request/response + OpenAPI route defs
│   │       └── events.ts           # SSE event type schemas
│   └── tests/
│       ├── helpers.ts              # mock factories, SSE parser, test client setup
│       ├── health.test.ts
│       ├── auth.test.ts
│       ├── sessions.test.ts
│       ├── chat.test.ts
│       ├── agent.test.ts
│       ├── confirmation.test.ts
│       └── tools.test.ts
├── frontend/                        # unchanged (SolidJS)
│   ├── package.json
│   └── ...
└── ...
```

## Drizzle Schema Design

The existing SQLite schema translates directly to Drizzle table definitions:

```typescript
// backend/src/schema.ts
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
}

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey().notNull(),
  title: text("title").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolCalls: text("tool_calls", { mode: "json" }).$type<ToolCallInfo[]>(),
    toolCallId: text("tool_call_id"),  // links tool-result to its call
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("ix_messages_session").on(table.sessionId, table.id),
  ]
);
```

Using `{ mode: "json" }` with `.$type<ToolCallInfo[]>()` gives us automatic `JSON.parse`/`JSON.stringify` on read/write, so we never handle raw JSON strings in application code. The underlying column is still `TEXT` — no schema change from the Python version.

### Drizzle Configuration

```typescript
// backend/drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env["VOXPILOT_DB_PATH"] ?? "voxpilot.db",
  },
});
```

### Database Instance

```typescript
// backend/src/db.ts
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function initDb(path: string = "voxpilot.db") {
  const sqlite = new Database(path);
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export function closeDb() {
  // bun:sqlite Database is GC'd, but we clear the ref
  db = undefined;
}
```

### Query Translation Examples

Current raw SQL → Drizzle query builder:

```typescript
// List sessions (ordered by updated_at DESC)
const result = await db
  .select()
  .from(sessions)
  .orderBy(desc(sessions.updatedAt));

// Get session with messages
const session = await db.query.sessions.findFirst({
  where: eq(sessions.id, sessionId),
});
const msgs = await db
  .select()
  .from(messages)
  .where(eq(messages.sessionId, sessionId))
  .orderBy(asc(messages.id));

// Insert message + touch session
// toolCalls is typed as ToolCallInfo[] | null — Drizzle handles
// JSON.stringify/parse automatically via { mode: "json" }
await db.insert(messages).values({
  sessionId,
  role,
  content,
  toolCalls: toolCalls ?? null,
  toolCallId: toolCallId ?? null,
  createdAt: new Date().toISOString(),
});
await db
  .update(sessions)
  .set({ updatedAt: new Date().toISOString() })
  .where(eq(sessions.id, sessionId));

// Delete session (CASCADE deletes messages)
await db.delete(sessions).where(eq(sessions.id, sessionId));
```

### Migrations Workflow

- **Development**: `bunx drizzle-kit push` applies schema changes directly to the dev DB.
- **Production / CI**: `bunx drizzle-kit generate` creates versioned SQL migration files in `drizzle/`. Apply with `bunx drizzle-kit migrate`.
- The `just generate` recipe will run `drizzle-kit generate` alongside OpenAPI codegen.

## Migration Phases

### Phase 1 — Scaffold & Infrastructure

**Target directory**: `backend-ts/` (parallel to existing `backend/`; swapped in Phase 10)

**Files**: `package.json`, `tsconfig.json`, `biome.json`, `drizzle.config.ts`, `src/index.ts`, `src/config.ts`, `src/db.ts`, `src/schema.ts`

1. Scaffold with CLI tools:
   ```sh
   bun create hono backend-ts --template bun --pm bun --install
   cd backend-ts
   bunx @biomejs/biome init   # generates biome.json with sensible defaults
   ```
   This gives us `package.json`, `tsconfig.json`, `biome.json`, `src/index.ts`,
   and `.gitignore` out of the box.
2. Add remaining dependencies:
   ```sh
   bun add @hono/zod-openapi zod drizzle-orm openai markdown-it
   bun add -d drizzle-kit @types/markdown-it typescript
   ```
   (`hono`, `@types/bun` are already installed by the scaffold)
3. Extend `tsconfig.json` — add `noUncheckedIndexedAccess`, `ES2022` target, path aliases
4. Tweak `biome.json` — set `indentStyle: "space"`, `indentWidth: 2` to match frontend
5. Create `drizzle.config.ts` (manual — drizzle-kit has no `init` command)
6. Define Drizzle schema (`src/schema.ts`) matching existing DDL exactly
7. Create config module (`src/config.ts`) — Zod schema parsing `Bun.env` with `VOXPILOT_` prefix
8. Create `src/db.ts` — Drizzle instance with `bun:sqlite`, WAL mode, foreign keys
9. Flesh out `src/index.ts` — Hono app with `serve()`, CORS, lifespan init/close
10. Verify: `bun run src/index.ts` starts and connects to SQLite

### Phase 2 — Schemas & Middleware

**Files**: `src/schemas/api.ts`, `src/schemas/events.ts`, `src/middleware/auth.ts`

1. Port all Pydantic models to Zod schemas with `@hono/zod-openapi` decorators
2. Create auth middleware that reads `gh_token` cookie → 401 if missing
3. Wire `@hono/zod-openapi` to auto-export the OpenAPI spec at `/api/openapi.json`
4. Verify: `just generate` produces identical `frontend/openapi.json` to current

### Phase 3 — Health & Auth Routes

**Files**: `src/routes/health.ts`, `src/routes/auth.ts`, `src/services/github.ts`

1. Port `/api/health` (trivial)
2. Port GitHub OAuth helpers (`fetch` replaces `httpx`)
3. Port auth routes (login, callback, logout, me) — cookie handling via Hono's `setCookie`/`getCookie`
4. Port tests: `health.test.ts`, `auth.test.ts`

### Phase 4 — Session CRUD

**Files**: `src/routes/sessions.ts`, `src/services/sessions.ts`

1. Port session service — Drizzle queries replace raw SQL
2. Port session routes (list, create, get, delete, update)
3. Port tests: `sessions.test.ts`
4. Verify: all session operations work against real SQLite

### Phase 5 — Markdown Service

**Files**: `src/services/markdown.ts`

1. Install `markdown-it` (the original JS library that `markdown-it-py` was ported from)
2. Port `render_markdown()`, `set_fence_renderer()`, `set_render_rule()`, `get_renderer()`
3. Verify: identical HTML output for sample markdown inputs

### Phase 6 — Tool Framework

**Files**: `src/tools/base.ts`, `src/tools/registry.ts`, all tool implementations

1. Define `Tool` interface (replaces Python ABC), using OpenAI SDK types
   (`FunctionDefinition`, `FunctionParameters`, `ChatCompletionTool`) instead of
   hand-rolled `Record<string, unknown>`:
   ```typescript
   import type {
     ChatCompletionTool,
     FunctionDefinition,
     FunctionParameters,
   } from "openai/resources";

   interface Tool {
     definition: FunctionDefinition;  // { name, description, parameters }
     requiresConfirmation: boolean;
     execute(args: Record<string, unknown>, workDir: string): Promise<string>;
     toOpenAiTool(): ChatCompletionTool;
   }
   ```
   `FunctionDefinition.parameters` is typed as `FunctionParameters` (the SDK's
   own JSON Schema type), so tool parameter schemas stay in sync with the API.
2. Create `resolvePath()` utility (path traversal guard using `path.resolve` + `path.relative`)
3. Port each tool:
   - `read-file.ts` — `Bun.file()` for reading, line slicing
   - `read-file-external.ts` — absolute paths, `requiresConfirmation: true`
   - `list-directory.ts` — `readdir` with skip dirs
   - `grep-search.ts` — recursive search with pattern matching
   - `glob-search.ts` — `Bun.Glob` or `fast-glob`
4. Create `ToolRegistry` (Map-based)
5. Port tests: `tools.test.ts`

### Phase 7 — Stream Registry & Confirmation

**Files**: `src/services/streams.ts`

The Python version uses `asyncio.Queue` for two purposes that have different
idiomatic TypeScript solutions:

#### Message channel (multi-value producer/consumer)

`POST /messages` puts payloads; the SSE generator reads in a loop with a 30 s
keepalive timeout.  This is a genuine async channel — use
**`Promise.withResolvers()`** (built into Bun) with **`AbortSignal`** for
timeouts instead of rolling a queue + setTimeout:

```typescript
class AsyncChannel<T> {
  private buffer: T[] = [];
  private waiters: PromiseWithResolvers<T>[] = [];

  /** Non-blocking send — resolves a waiting receiver or buffers. */
  send(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(value);
    } else {
      this.buffer.push(value);
    }
  }

  /** Await the next value.  Pass an `AbortSignal` for timeout/cancellation. */
  async receive(signal?: AbortSignal): Promise<T> {
    const buffered = this.buffer.shift();
    if (buffered !== undefined) return buffered;

    const deferred = Promise.withResolvers<T>();
    this.waiters.push(deferred);

    if (signal) {
      const onAbort = () => {
        const idx = this.waiters.indexOf(deferred);
        if (idx >= 0) this.waiters.splice(idx, 1);
        deferred.reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      return deferred.promise.finally(() =>
        signal.removeEventListener("abort", onAbort),
      );
    }

    return deferred.promise;
  }
}
```

Usage in the SSE generator (replaces `asyncio.wait_for(queue.get(), timeout=30)`):

```typescript
try {
  const payload = await channel.receive(AbortSignal.timeout(30_000));
} catch {
  // Timeout — send keepalive and continue
  await stream.writeSSE({ comment: "keepalive" });
}
```

#### Confirmation (single-value future)

The confirmation queue is always single-use: the agent awaits ONE boolean, then
the confirm endpoint resolves it.  A queue is overkill — use a bare
**`PromiseWithResolvers<boolean>`** stored in a `Map`:

```typescript
interface PendingConfirm {
  toolCallId: string;
  deferred: PromiseWithResolvers<boolean>;
}

// In SessionStreamRegistry:
private pending = new Map<string, PendingConfirm>();

awaitConfirmation(sessionId: string, toolCallId: string, signal?: AbortSignal): Promise<boolean> {
  const deferred = Promise.withResolvers<boolean>();
  this.pending.set(sessionId, { toolCallId, deferred });
  if (signal) {
    signal.addEventListener("abort", () => {
      this.pending.delete(sessionId);
      deferred.resolve(false);  // treat timeout/cancel as denial
    }, { once: true });
  }
  return deferred.promise;
}

resolveConfirmation(sessionId: string, toolCallId: string, approved: boolean): boolean {
  const entry = this.pending.get(sessionId);
  if (!entry || entry.toolCallId !== toolCallId) return false;
  this.pending.delete(sessionId);
  entry.deferred.resolve(approved);
  return true;
}
```

Called with `AbortSignal.timeout()` for the 5-minute confirmation deadline:

```typescript
const approved = await registry.awaitConfirmation(
  sessionId, toolCallId, AbortSignal.timeout(300_000),
);
```

#### Why not Web Streams (`ReadableStream` / `TransformStream`)?

Web Streams are the other obvious candidate, but they're a poor fit here:
- No native timeout on reads — you'd still need `AbortSignal` wiring
- A locked reader prevents the writer from detecting whether the consumer
  disconnected (the SSE cleanup path)
- Closing a stream is final — you can't reuse it after a keepalive cycle
- More API surface for what is fundamentally a simple put/get pattern

`AsyncChannel` + `PromiseWithResolvers` are smaller, testable, and use only
built-in platform primitives.

#### Implementation steps

1. Create `AsyncChannel<T>` class in `src/services/streams.ts`
2. Port `SessionStreamRegistry` using `Map<string, AsyncChannel<...>>` for
   message delivery and `Map<string, PendingConfirm>` for confirmations
3. Use `AbortSignal.timeout()` for keepalive and confirmation deadlines
4. Port tests: `confirmation.test.ts`

### Phase 8 — Agent Loop

**Files**: `src/services/agent.ts`

1. Port `run_agent_loop()` as an async generator:
   ```typescript
   async function* runAgentLoop(opts: {
     messages: ChatMessage[];
     model: string;
     ghToken: string;
     workDir: string;
     db: DrizzleDb;
     sessionId: string;
     maxIterations?: number;
     isDisconnected?: () => boolean;
     requestConfirmation?: (toolCallId: string) => Promise<boolean>;
   }): AsyncGenerator<SseEvent> { ... }
   ```
2. Use `openai` npm SDK streaming (`stream: true`, async iteration)
3. Port `_StreamedToolCall` accumulator
4. Port tool execution → confirmation → result loop
5. Port tests: `agent.test.ts`

### Phase 9 — Chat Routes (SSE)

**Files**: `src/routes/chat.ts`

1. Port `GET /api/sessions/{id}/stream` — Hono streaming response:
   ```typescript
   app.get("/api/sessions/:id/stream", async (c) => {
     return streamSSE(c, async (stream) => {
       // replay history, send ready, await queue, run agent loop
     });
   });
   ```
2. Port `POST /api/sessions/{id}/messages` — enqueue message, return 202
3. Port `POST /api/sessions/{id}/confirm` — resolve pending confirmation
4. Port tests: `chat.test.ts`

### Phase 10 — Integration & Cleanup

1. Update `Justfile` recipes:
   ```just
   dev-backend:
       cd backend && bun run --hot src/index.ts

   test:
       cd backend && bun test

   lint:
       bunx @biomejs/biome check backend/src backend/tests
       cd frontend && npx tsc --noEmit

   typecheck:
       cd backend && bunx tsc --noEmit
       cd frontend && npx tsc --noEmit

   format:
       bunx @biomejs/biome check --write backend/src backend/tests

   generate:
       cd backend && bun run src/export-openapi.ts
       cd frontend && bun run generate

   install:
       cd backend && bun install
       cd frontend && bun install
   ```
2. Update `frontend/vite.config.ts` proxy if port changes
3. Update `ARCHITECTURE.md` to reflect new stack
4. Run full test suite, verify parity
5. Manual smoke test: OAuth → create session → chat → tool calls → confirm
6. Swap directories:
   ```sh
   mv backend backend-py   # keep Python code around temporarily
   mv backend-ts backend    # new TS backend takes its place
   ```
7. Verify everything still works with the new path, then delete `backend-py/`

## Dependencies

### `backend/package.json`

```json
{
  "name": "voxpilot-backend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@hono/zod-openapi": "^1.2",
    "drizzle-orm": "^0.45",
    "hono": "^4.11",
    "markdown-it": "^14.1",
    "openai": "^6.22",
    "zod": "^4.3"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4",
    "@types/bun": "^1.3",
    "@types/markdown-it": "^14.1",
    "drizzle-kit": "^0.31",
    "typescript": "^5.9"
  }
}
```

## Key Translation Patterns

### asyncio.Queue → AsyncChannel + PromiseWithResolvers

Python's `asyncio.Queue` is used for two distinct purposes:

1. **Message delivery** (multi-value channel) → `AsyncChannel<T>` class built on
   `Promise.withResolvers()`.  `send()` buffers or resolves; `receive(signal?)`
   awaits with optional `AbortSignal` for timeout.
2. **Tool confirmation** (single-value future) → bare `PromiseWithResolvers<boolean>`
   stored in a `Map`.  No queue abstraction needed — the agent awaits one boolean,
   the confirm endpoint resolves it.

`AbortSignal.timeout(ms)` replaces `asyncio.wait_for()` for both keepalive and
confirmation deadlines — it's composable (via `AbortSignal.any()`) and built into Bun.

### Async Generator SSE

Python `run_agent_loop()` yields dicts. In TypeScript, it yields typed objects consumed by Hono's `streamSSE()`:

```typescript
for await (const event of runAgentLoop(opts)) {
  await stream.writeSSE({ event: event.event, data: JSON.stringify(event.data) });
}
```

### Pydantic → Zod (v4)

Zod v4 is a major upgrade from v3. Key differences from v3 that affect us:
- `z.infer<typeof schema>` still works as before
- `.default()` behavior is unchanged for simple types
- Error formatting changed — use `z.prettifyError()` instead of `.format()`
- `@hono/zod-openapi` v1.x is built for Zod v4 compatibility

```python
# Python
class SendMessageRequest(BaseModel):
    content: str
    model: str = "gpt-4o"
```

```typescript
// TypeScript (Zod v4)
const SendMessageRequest = z.object({
  content: z.string(),
  model: z.string().default("gpt-4o"),
});
type SendMessageRequest = z.infer<typeof SendMessageRequest>;
```

### Path Traversal Guard

```python
# Python
resolved = (work_dir / raw).resolve()
resolved.relative_to(work_dir.resolve())
```

```typescript
// TypeScript
import { resolve, relative } from "node:path";

function resolvePath(raw: string, workDir: string): string | null {
  const resolved = resolve(workDir, raw);
  const rel = relative(resolve(workDir), resolved);
  if (rel.startsWith("..") || resolve(workDir, rel) !== resolved) return null;
  return resolved;
}
```

### Drizzle async & sync APIs

Drizzle provides both async and sync APIs over `bun:sqlite`. The default uses `await`:

```typescript
// Async (default) — same ergonomics as aiosqlite
const result = await db.select().from(sessions);

// Sync alternatives (mirror bun:sqlite's native API)
const result = db.select().from(sessions).all();
const row = db.select().from(sessions).get();
```

We'll use the async API by default to keep the code consistent with the rest of the async server.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `bun:sqlite` is sync under the hood | Drizzle wraps it with async API by default. Our queries are small (single-user app), so no concern. Sync `.all()`/`.get()` available if needed. |
| OpenAI npm SDK v6 streaming API differs from Python | v6 API uses async iteration over chunks, same pattern as Python. The v5→v6 upgrade mostly affects retry/timeout config — streaming is unchanged. |
| Zod v4 breaking changes | Zod v4 is a major release. Core schema APIs (`z.object`, `z.string`, `.default()`, `z.infer`) are stable. Main risk is `@hono/zod-openapi` compatibility — v1.x targets Zod v4. Test OpenAPI spec generation early in Phase 2. |
| `markdown-it` JS output differs from `markdown-it-py` | They share the same test suite. Run diff tests on sample markdown to verify. |
| Hono SSE streaming edge cases | Hono's `streamSSE` is well-tested. Keep the keepalive comment pattern (30s timeout). |
| Drizzle ORM overhead vs raw SQL | Drizzle is "headless" — thin SQL wrapper, ~7.4kB. Negligible overhead for our query volume. |
| Test parity | Port tests 1:1. Each phase includes its test files. Don't delete Python until all TS tests pass. |

## Definition of Done

- [ ] All 8 API routes return identical responses to the Python backend
- [ ] OpenAPI spec generated from Hono/Zod matches the current spec (modulo formatting)
- [ ] Frontend works without changes (same API contract, same cookies, same SSE events)
- [ ] All ~69 tests ported and passing in `bun test`
- [ ] `just check` passes (install, generate, lint, typecheck, test)
- [ ] Manual smoke test: OAuth → session CRUD → chat with tool calls → confirmation flow
- [ ] Python backend deleted, `ARCHITECTURE.md` updated
