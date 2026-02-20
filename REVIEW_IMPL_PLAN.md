# V2 Inline Review — Implementation Plan

> **Status: V1 implemented + post-V1 enhancements.** All 11 steps are
> complete. Post-V1 adds: full-file view toggle with server-rendered HTML
> (diff highlights + deletion interleaving), `git_diff` redesign with
> explicit `from`/`to` refs (including synthetic `WORKTREE`/`INDEX`),
> `fullTextHtml` column on `artifact_files`, and repo-root path fix.
> Tests cover diff-parser, diff-render, artifact CRUD, and tools
> (68 new tests, 208 total). See "What's deferred" at the bottom.

Server parses unified diffs once into a canonical `DiffDocument`, resolves post-change full file text from git, persists the structured model and per-file pre-rendered HTML (both chunk-view and full-file view), and streams lightweight metadata to the client. The frontend never parses diffs — it renders per-file server HTML directly into carousel pages, toggles between chunk and full-file views, and posts interactions (viewed, comments, submit) back to REST endpoints that persist immediately.

---

## Data Model

### DiffDocument

One per tool invocation that produces a diff.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | UUID |
| `version` | `number` | Schema version (start at `1`) |
| `sessionId` | `string` | FK to sessions |
| `toolName` | `string` | `git_diff` or `git_show` |
| `toolCallId` | `string` | Links to the originating tool call |
| `commitRef` | `string \| null` | For `git_show`; null for `git_diff` |
| `title` | `string` | Agent-generated changeset summary |
| `status` | `enum` | `pending`, `approved`, `changes_requested` |
| `totalFiles` | `number` | |
| `totalAdditions` | `number` | |
| `totalDeletions` | `number` | |
| `createdAt` | `string` | ISO timestamp |

### DiffFile

One per changed file in the artifact.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Stable ID (hash of artifact + path) |
| `artifactId` | `string` | FK to DiffDocument |
| `path` | `string` | Repo-relative |
| `changeType` | `enum` | `added`, `modified`, `deleted`, `renamed` |
| `oldPath` | `string \| null` | For renames |
| `additions` | `number` | |
| `deletions` | `number` | |
| `viewed` | `boolean` | Persisted immediately on toggle |
| `html` | `string` | Pre-rendered sanitized diff HTML for this file (carousel page content) |
| `hunksJson` | `json` | Array of `DiffHunk` (see below) |
| `fullTextAvailable` | `boolean` | False for binary/too-large |
| `fullTextLineCount` | `number \| null` | |
| `fullTextContent` | `string \| null` | Post-change full text, fetched from git blob |
| `fullTextHtml` | `string \| null` | Server-rendered full-file HTML with diff highlights + interleaved deletions |

### DiffHunk

Stored inside `hunksJson`.

| Field | Type |
|-------|------|
| `id` | `string` |
| `header` | `string` (`@@ ... @@`) |
| `oldStart`, `oldLines` | `number` |
| `newStart`, `newLines` | `number` |
| `lines` | `DiffLine[]` |

### DiffLine

Stored inside hunk.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Stable anchor for DOM + comments |
| `kind` | `enum` | `context`, `add`, `del` |
| `oldLine` | `number \| null` | |
| `newLine` | `number \| null` | |
| `content` | `string` | Raw text (escaped by HTML renderer) |
| `fullTextLine` | `number \| null` | Mapped post-change line number |

### ReviewComment

Separate table, persisted immediately.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | UUID |
| `artifactId` | `string` | FK |
| `fileId` | `string` | FK to DiffFile |
| `lineId` | `string \| null` | Null = file-level comment |
| `lineNumber` | `number \| null` | Display reference |
| `content` | `string` | |
| `createdAt` | `string` | |

---

## SSE + API Surface

### New SSE Event

`review-artifact` — emitted once after tool execution, metadata only (no full text, no full HTML).
Also replayed during history replay (before `ready`) so the frontend populates its artifact map on reconnect.

```json
{
  "artifactId": "...",
  "title": "...",
  "status": "pending",
  "totalFiles": 3,
  "totalAdditions": 44,
  "totalDeletions": 4,
  "files": [
    { "id": "...", "path": "src/auth.ts", "changeType": "modified", "additions": 12, "deletions": 3 }
  ]
}
```

### New REST Endpoints

Mounted as `artifactRouter` in `backend/src/index.ts`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/artifacts/:id` | Full artifact with files, hunks, rendered HTML |
| `GET` | `/api/artifacts/:id/files/:fileId/full-text` | Lazy full-text fetch |
| `PATCH` | `/api/artifacts/:id/files/:fileId/viewed` | Toggle viewed (body: `{ viewed: bool }`) |
| `POST` | `/api/artifacts/:id/files/:fileId/comments` | Add file or line comment |
| `DELETE` | `/api/artifacts/:id/comments/:commentId` | Remove comment |
| `POST` | `/api/artifacts/:id/submit` | Submit review → updates status, sends digest to agent |

File event payloads include `viewed` status so history replay restores card state correctly.

### Existing Contract Changes (additive only)

- `ToolResultEvent` in `backend/src/schemas/events.ts`: add optional `artifact_id`
- `MessageEvent` in `backend/src/schemas/events.ts`: add optional `artifact_id` for history replay
- `messages` table in `backend/src/schema.ts`: add nullable `artifactId` column

---

## Implementation Steps

### 1. Domain types + parser ✅

- `backend/src/schemas/diff-document.ts`: Zod schemas for `DiffDocument`, `DiffFile`, `DiffHunk`, `DiffLine`, `ReviewComment`, `ChangeType`, `ArtifactStatus`.
- `backend/src/services/diff-parser.ts`: `parseUnifiedDiff()` and `buildDiffFiles()` — parse unified diff text into typed model; generate stable IDs via deterministic hash; build `fullTextLine` mapping.

### 2. Full-text resolver ✅

- `backend/src/services/diff-fulltext.ts`: `resolveFullText(filePath, toRef, workDir)` — resolve post-change file content using the `toRef` parameter:
  - `WORKTREE` → read from filesystem via `Bun.file()`
  - `INDEX` → read from staging area via `git show :path`
  - Any other ref → read from git tree via `git show ref:path`
- Caps at 500 KB, marks binary as unavailable.
- **Important**: `workDir` must be the git repo root (not cwd), since diff paths are repo-root-relative. The pipeline resolves this via `ensureGitRepo()`.

### 3. HTML renderer ✅

- `backend/src/services/diff-render.ts`:
  - `renderDiffFileHtml()` — walks parsed hunks, emits one escaped HTML table fragment per `DiffFile` with stable `data-line-id`/`data-file-id`/`data-hunk-id` attributes, CSS classes per line kind (`diff-line-add`/`diff-line-del`/`diff-line-context`).
  - `renderFullFileHtml()` — renders the complete post-change file with diff highlights: added lines get `fulltext-line-add` class, deleted lines are interleaved at their original positions with `fulltext-line-del` class (strikethrough, hidden line number). Uses `fullTextLine` mapping from hunks to correlate diff lines to full-file positions.
- Each file gets both `html` (chunk view) and `fullTextHtml` (full-file view) — the frontend toggles between them.

### 4. Persistence ✅

- `backend/src/schema.ts`: `reviewArtifacts`, `artifactFiles`, `reviewComments` tables + nullable `artifactId` on `messages`.
- `backend/src/db.ts`: DDL via Drizzle `migrate()` from `drizzle-orm/bun-sqlite/migrator`, applying migrations from `backend/drizzle/`.
- `backend/src/services/artifacts.ts`: `createArtifact()`, `createArtifactFile()`, `getArtifact()`, `setFileViewed()`, `addComment()`, `deleteComment()`, `updateArtifactStatus()`, `getFileFullText()`, `getArtifactComments()`, `getSessionArtifactSummaries()`.

### 5. Agent integration ✅

- `backend/src/services/agent.ts`: after `git_diff`/`git_show` execution, invokes `createReviewArtifact()` pipeline → yields `review-artifact` SSE event alongside existing `tool-result`.
  - Extracts `toRef` from tool args: `git_show` → `commit` arg (default `"HEAD"`), `git_diff` → `to` arg (default `"WORKTREE"`).
- `backend/src/services/artifact-pipeline.ts`: orchestrates parse → fulltext → render → persist in one function.
  - Resolves git repo root via `ensureGitRepo()` for correct path resolution (diff paths are repo-root-relative, not cwd-relative).
  - Generates both `html` (chunk view) and `fullTextHtml` (full-file view) per file.
- `artifact_id` is set on the tool message at insert time via `addMessage()` (not via a post-hoc UPDATE).
- Errors are non-fatal (caught, logged to console).

### 6. Event/API contracts ✅

- `backend/src/schemas/events.ts`: `ReviewArtifactEvent`, `ReviewArtifactFileEvent` (with optional `viewed` for replay); optional `artifact_id` on `ToolResultEvent` and `MessageEvent`.
- `backend/src/schemas/api.ts`: `ViewedRequest`, `AddCommentRequest`.

### 7. Artifact routes ✅

- `backend/src/routes/artifacts.ts` with all 6 endpoints.
- Mounted via `app.route("/", artifactRouter)` in `backend/src/index.ts`.
- Submit builds a structured digest of comments and sends as user message to agent via broadcaster.

### 8. Frontend data layer ✅

- `frontend/src/sse.ts`: `review-artifact` listener, `ReviewArtifactPayload` type.
- `frontend/src/store.ts`: `ArtifactSummary`, `ArtifactFileSummary`, `ArtifactFileDetail`, `ReviewCommentData`, `ArtifactDetail` types; `artifacts`, `reviewOverlayArtifactId`, `reviewDetail` signals.
- `frontend/src/api-client.ts`: `fetchArtifact()`, `fetchFileFullText()`, `patchFileViewed()`, `postFileComment()`, `deleteArtifactComment()`, `submitReview()`.
- `frontend/src/streaming.ts`: wires `onReviewArtifact` + `onToolResult` (with `artifact_id`); clears artifact map on session switch; preserves `artifactId` through `onDone` finalization.

### 9. Layer 1: Changeset Card ✅

- `frontend/src/components/ChangesetCard.tsx`: client-rendered from artifact metadata signal (title, directory-grouped file tree with stats, viewed indicators ●/○, "Review next" button, status line).
- Shown inline in chat via `frontend/src/components/ToolCallBlock.tsx` (streaming) and `frontend/src/components/MessageBubble.tsx` (history) when message has `artifact_id`.

### 10. Layer 2: Review Overlay ✅

- `frontend/src/components/ReviewOverlay.tsx`: full-screen carousel reusing `attachSwipeHandler`.
- Per-file page renders `file.html` via `innerHTML` — one carousel page per file.
- **Full-file view toggle**: 📄/± button in the header switches between chunk view (`html`) and full-file view (`fullTextHtml`). Only shown when `fullTextHtml` is available. Resets to chunk view on file navigation.
- Bottom bar with viewed checkbox + comment count + comment input.
- Auto-mark viewed on swipe-past.
- Final page is review summary with submit gating (disabled until all viewed).
- Mounted in `frontend/src/components/ChatView.tsx`.

### 11. Submit flow ✅

- `POST /api/artifacts/:id/submit` collects all comments as structured digest, sends to agent as a user message, updates artifact `status`, closes overlay, and updates changeset card state.

---

## Verification

- **Parser + renderer**: ✅ unit tests in `backend/tests/diff-parser.test.ts` (16 tests) and `backend/tests/diff-render.test.ts` (24 tests — 14 renderDiffFileHtml + 10 renderFullFileHtml including 6 deletion interleaving tests).
- **Artifact service**: ✅ CRUD + status + comment tests in `backend/tests/artifacts.test.ts` (20 tests).
- **Tools**: ✅ `backend/tests/tools.test.ts` includes `git_diff` from/to tests (same-ref rejection, invalid-ref validation).
- **Agent integration**: not yet extended — `backend/tests/agent.test.ts` does not assert artifact creation.
- **SSE contract**: not yet extended — `backend/tests/chat.test.ts` does not assert `review-artifact` event emission.
- **End-to-end**: manually verified — stream a `git_diff`, artifact SSE fires, reload session and card persists with viewed state, open overlay, toggle viewed, toggle full-file view, add comment, submit review.

---

## What's Deferred

| Item | Notes |
|------|-------|
| Line-level comments via long-press | UI scaffolding exists (line IDs in DOM) but no long-press gesture handler wired |
| Syntax highlighting in diff | HTML renderer emits plain `<code>` — no tokenization |
| Jump-to-file from page indicator | Page indicator shows file name but tapping it doesn't open a file picker |
| Agent integration test coverage | `agent.test.ts` and `chat.test.ts` not yet extended |
| Database migrations | Handled via Drizzle `migrate()` — migrations in `backend/drizzle/` applied on startup |

---

## Locked Decisions

| Decision | Choice |
|----------|--------|
| SSE delivery | Dedicated `review-artifact` event, metadata only |
| Artifact linkage | Nullable `artifactId` on `messages` table |
| HTML storage | Persist rendered HTML per file on `DiffFile` rows |
| Full text | Post-change only, from git blobs, stored per file, fetched lazily |
| Full-file HTML | Server-rendered with diff highlights + interleaved deletions, persisted per file |
| Diff tool | `git_diff` uses explicit `from`/`to` with synthetic refs `WORKTREE` and `INDEX` |
| Full-text path resolution | Uses git repo root (via `rev-parse --show-toplevel`), not cwd |
| Interactions | Viewed + comments persisted immediately via REST |
| Scope | `git_diff` and `git_show` only |
