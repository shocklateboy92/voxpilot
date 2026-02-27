# Plan: Persist Diff Refs with Drizzle/SQLite + Hono RPC

## Goal

Replace the in-memory `Map<string, DiffCacheEntry>` diff cache with a
Drizzle/SQLite database so diff ref UUIDs survive server restarts. Re-establish
Hono RPC (`hc<AppType>()`) for end-to-end type safety from database to frontend
components.

## Context

This project previously had Drizzle + SQLite + Hono RPC. It was removed in commit
`b81f0f3` ("refactor: Phase 1 — backend scaffold with OpenCode proxy"). We are
bringing it back in a minimal form — only the tables needed for diff cache
persistence, but with full RPC wiring across all routes.

### Current state

- **Backend**: Hono HTTP server + MCP tool server + OpenCode SDK proxy
- **Diff cache**: In-memory `Map` in `src/mcp.ts` with 30-min TTL, keyed by UUID
- **Frontend**: Plain `fetch()` calls with manually duplicated response types
- **Database**: None (old `voxpilot.db` file exists but is unused)
- **RPC**: None

### Previous patterns (from git history)

- `bun:sqlite` driver (NOT `better-sqlite3`) via `drizzle-orm/bun-sqlite`
- `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON`
- Auto-migrate on first `getDb()` call
- Chained `.route()` calls (NOT imperative `app.route()`) so `typeof app`
  propagates all route types for `hc<AppType>()`
- `@hono/zod-validator` (`zValidator`) makes request schemas part of the route
  type signature
- Frontend `tsconfig.json` paths + `vite.config.ts` aliases both point to
  `@backend/*` and share the backend's `hono` installation

---

## Implementation Steps

### Phase 1: Backend Database Layer

#### 1.1 Install dependencies

```bash
# In backend/
bun add drizzle-orm @hono/zod-validator
bun add -d drizzle-kit
```

#### 1.2 Create `backend/drizzle.config.ts`

```ts
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

#### 1.3 Create `backend/src/schema.ts`

Two tables:

**`diff_entries`** — one row per `show_diff` tool invocation:

| Column          | Type    | Notes                           |
| --------------- | ------- | ------------------------------- |
| `id`            | text PK | UUID from `randomUUID()`        |
| `from_ref`      | text    | Symbolic ref (HEAD, branch)     |
| `to_ref`        | text    | Symbolic ref                    |
| `resolved_from` | text    | Pinned SHA or synthetic ref     |
| `resolved_to`   | text    | Pinned SHA or synthetic ref     |
| `repo_root`     | text    | Git repo root path              |
| `path`          | text    | Optional path filter (nullable) |
| `created_at`    | text    | ISO timestamp                   |

**`diff_entry_files`** — one row per changed file in a diff:

| Column           | Type    | Notes                      |
| ---------------- | ------- | -------------------------- |
| `id`             | text PK | UUID                       |
| `entry_id`       | text FK | → diff_entries.id, cascade |
| `file_path`      | text    | Relative file path         |
| `additions`      | integer | Lines added                |
| `deletions`      | integer | Lines deleted              |
| `before_content` | text    | Full text of old version   |
| `after_content`  | text    | Full text of new version   |

Index on `diff_entry_files.entry_id`.

#### 1.4 Create `backend/src/db.ts`

Same pattern as old code:

```ts
import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!db) {
    const path = process.env["VOXPILOT_DB_PATH"] ?? "voxpilot.db";
    const sqlite = new Database(path);
    sqlite.run("PRAGMA journal_mode = WAL");
    sqlite.run("PRAGMA foreign_keys = ON");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
  }
  return db;
}

export function closeDb() {
  db = undefined;
}
```

#### 1.5 Delete old `voxpilot.db` and generate fresh migration

```bash
rm backend/voxpilot.db
bunx drizzle-kit generate   # creates backend/drizzle/0000_*.sql
```

Make sure `voxpilot.db` is in `.gitignore`.

---

### Phase 2: Extract `getFileAtRef` to Shared Service

#### 2.1 Move `getFileAtRef()` from `backend/src/routes/review.ts` to `backend/src/services/git-utils.ts`

The function reads file content at a git ref (supporting synthetic refs INDEX and
WORKTREE). Both `mcp.ts` (to capture before/after content) and `routes/review.ts`
(to serve on-demand diffs) need it.

```ts
// Add to backend/src/services/git-utils.ts:

export async function getFileAtRef(
  ref: string,
  filePath: string,
  workDir: string,
): Promise<string> {
  if (ref === "WORKTREE") {
    try {
      const file = Bun.file(`${workDir}/${filePath}`);
      return await file.text();
    } catch {
      return "";
    }
  }
  if (ref === "INDEX") {
    const result = await runGit(["show", `:${filePath}`], workDir);
    return result.exitCode === 0 ? result.stdout : "";
  }
  const result = await runGit(["show", `${ref}:${filePath}`], workDir);
  return result.exitCode === 0 ? result.stdout : "";
}
```

Update `routes/review.ts` to import from `git-utils` instead of defining locally.

---

### Phase 3: Refactor MCP Tool to Use Database

#### 3.1 Modify `backend/src/mcp.ts`

**Remove:**

- The in-memory `diffCache` Map
- The `CACHE_TTL_MS` constant
- The `setInterval` eviction timer
- The `DiffCacheEntry` interface (moves to schema or a shared type)

**Add:**

- Import `getDb` and schema
- Import `getFileAtRef` from `git-utils`
- In the `show_diff` tool handler, after computing numstat and resolving refs:
  1. For each file in the diff, call `getFileAtRef()` for both the `from` and `to`
     refs to capture the full file content
  2. Insert a row into `diff_entries`
  3. Insert rows into `diff_entry_files` (with `before_content` and `after_content`)
- `getDiffCacheEntry(id)` becomes a database query:
  - `db.query.diffEntries.findFirst({ where: eq(id), with: { files: true } })`

**Keep exporting:**

- `getDiffCacheEntry()` — used by `routes/review.ts`
- `buildDiffArgs()` — used by `routes/review.ts`
- `DiffCacheEntry` type (or re-export from schema) — used by routes

---

### Phase 4: Zod Schemas + Hono RPC Routes

#### 4.1 Create `backend/src/schemas/api.ts`

Zod schemas for all request/response shapes used in route validation:

```ts
import { z } from "zod/v4";

// POST /api/review/format-diff
export const FormatDiffRequest = z.object({
  sessionId: z.string(),
  filePath: z.string(),
  printWidth: z.number(),
});

// POST /api/review/ref-diff
export const RefDiffRequest = z.object({
  from: z.string(),
  to: z.string(),
  filePath: z.string(),
  printWidth: z.number(),
  repoRoot: z.string().optional(),
  cacheId: z.string().optional(), // NEW: if provided, load content from DB
});

// GET /api/review/ref-diff/files (query params validated manually or via zValidator("query"))
export const RefDiffFilesQuery = z.object({
  from: z.string(),
  to: z.string(),
  path: z.string().optional(),
});
```

#### 4.2 Refactor `backend/src/routes/review.ts`

Convert from imperative `router.get()`/`router.post()` to **chained** method
calls with `zValidator`:

```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { FormatDiffRequest, RefDiffRequest } from "../schemas/api";
// ...

export function createReviewRouter(client: OpencodeClient, workDir: string) {
  return new Hono()
    .post("/format-diff", zValidator("json", FormatDiffRequest), async (c) => {
      const body = c.req.valid("json");
      // ...
    })
    .get("/ref-diff/cache/:id", (c) => {
      // ...
    })
    .get("/ref-diff/files", async (c) => {
      // ...
    })
    .post("/ref-diff", zValidator("json", RefDiffRequest), async (c) => {
      const body = c.req.valid("json");
      // If cacheId provided, load before/after content from DB
      // Otherwise fall back to live git (current behavior)
      // ...
    });
}
```

**Key**: The function now `return`s the chained Hono instance directly (not
assigning to a `const router` and returning it), so the return type carries
all route definitions.

#### 4.3 Refactor `backend/src/index.ts`

Chain `.route()` calls and export `AppType`:

```ts
const appBase = new Hono();
appBase.use("/*", cors({ origin: "*", credentials: true }));

export const app = appBase
  .route("/mcp", createMcpRouter(workDir))
  .route("/api/review", createReviewRouter(ocClient, workDir));

// Proxy and static can stay imperative — they don't need RPC types
app.all(`${OC_PREFIX}/*`, proxy(ocServer.url, OC_PREFIX));
app.use("/*", serveStatic({ root: "./static" }));
app.use("/*", serveStatic({ root: "./static", path: "index.html" }));

export type AppType = typeof app;
```

Call `getDb()` at startup to run migrations early:

```ts
import { getDb, closeDb } from "./db";
getDb();
process.on("SIGINT", () => {
  closeDb();
  process.exit(0);
});
```

---

### Phase 5: Frontend RPC Client

#### 5.1 Update `frontend/tsconfig.json`

Add path aliases:

```json
{
  "compilerOptions": {
    // ... existing options ...
    "baseUrl": ".",
    "paths": {
      "@backend/*": ["../backend/src/*"],
      "hono": ["../backend/node_modules/hono"],
      "hono/*": ["../backend/node_modules/hono/*"]
    }
  }
}
```

#### 5.2 Update `frontend/vite.config.ts`

Add resolve aliases so Vite bundles the same `hono` types at build time:

```ts
import path from "node:path";
// ...

export default defineConfig({
  // ... existing config ...
  resolve: {
    alias: {
      "@backend": path.resolve(__dirname, "../backend/src"),
      hono: path.resolve(__dirname, "../backend/node_modules/hono"),
    },
  },
});
```

#### 5.3 Create `frontend/src/api-client.ts`

```ts
import type { AppType } from "@backend/index";
import { hc } from "hono/client";

export const rpc = hc<AppType>(window.location.origin);
```

#### 5.4 Update `frontend/src/components/ChangesetCard.tsx`

- Remove the manually duplicated `DiffCacheEntry` interface
- Replace `fetch(`/api/review/ref-diff/cache/${id}`)` with:
  ```ts
  const res = await rpc.api.review["ref-diff"].cache[":id"].$get({
    param: { id },
  });
  ```
- The response type is inferred from the backend route definition

#### 5.5 Update `frontend/src/components/ReviewOverlay.tsx`

- Replace `fetch("/api/review/ref-diff", ...)` with:
  ```ts
  const res = await rpc.api.review["ref-diff"].$post({
    json: { from, to, filePath, printWidth, repoRoot },
  });
  ```

---

### Phase 6: Update `/api/review/ref-diff` POST to Use Cached Content

When the frontend opens a file diff from a persisted cache entry:

1. `ChangesetCard` passes a `cacheId` + `fileId` (or `filePath`) to the overlay
2. `ReviewOverlay` includes `cacheId` in the POST request
3. Backend route checks if `cacheId` is provided:
   - **Yes**: Load `before_content` and `after_content` from `diff_entry_files` in
     the database. Skip calling git entirely.
   - **No**: Fall back to live `getFileAtRef()` calls (current behavior, for
     backward compatibility or on-the-fly diffs)

This ensures old diffs remain viewable even if git state has changed.

---

## File Changes Summary

### Backend — New Files

| File                 | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `drizzle.config.ts`  | Drizzle Kit configuration                             |
| `src/schema.ts`      | Database schema (diff_entries, diff_entry_files)      |
| `src/db.ts`          | Database connection + auto-migration                  |
| `src/schemas/api.ts` | Zod schemas for HTTP request validation               |
| `drizzle/0000_*.sql` | Generated migration (run `bunx drizzle-kit generate`) |

### Backend — Modified Files

| File                        | Changes                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `package.json`              | Add `drizzle-orm`, `@hono/zod-validator`; add dev dep `drizzle-kit`             |
| `src/index.ts`              | Chain `.route()` calls, export `AppType`, call `getDb()` at startup             |
| `src/mcp.ts`                | Replace in-memory Map with DB writes; capture file content; remove TTL eviction |
| `src/routes/review.ts`      | Use `zValidator`, chained routes, support `cacheId` for DB-backed diffs         |
| `src/services/git-utils.ts` | Add `getFileAtRef()` (moved from review.ts)                                     |
| `.gitignore`                | Ensure `voxpilot.db` is listed                                                  |

### Backend — Deleted

| File          | Reason                                                       |
| ------------- | ------------------------------------------------------------ |
| `voxpilot.db` | Stale database from old schema; fresh one created on startup |

### Frontend — New Files

| File                | Purpose                           |
| ------------------- | --------------------------------- |
| `src/api-client.ts` | Hono RPC client (`hc<AppType>()`) |

### Frontend — Modified Files

| File                               | Changes                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `tsconfig.json`                    | Add `baseUrl`, `paths` for `@backend/*` and `hono/*` |
| `vite.config.ts`                   | Add `resolve.alias` for `@backend` and `hono`        |
| `src/components/ChangesetCard.tsx` | Use RPC client, remove duplicated `DiffCacheEntry`   |
| `src/components/ReviewOverlay.tsx` | Use RPC client                                       |

---

## Verification

After implementation:

1. `bun run --hot src/index.ts` — backend starts, auto-creates `voxpilot.db`,
   runs migrations
2. `bunx drizzle-kit studio` — can inspect the database tables
3. Invoke `show_diff` via the MCP tool → UUID persisted in DB
4. Restart backend → `GET /api/review/ref-diff/cache/:id` still returns the entry
5. Click a file in the ChangesetCard → diff renders from persisted file content
6. Frontend TypeScript compiles with no errors — all API calls are type-checked
   via `hc<AppType>()`
7. `bun test` — existing diff-render and format-diff tests still pass
