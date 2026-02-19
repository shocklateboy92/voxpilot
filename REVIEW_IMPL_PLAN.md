# V2 Inline Review — Implementation Plan

Server parses unified diffs once into a canonical `DiffDocument`, resolves post-change full file text from git, persists the structured model and per-file pre-rendered HTML, and streams lightweight metadata to the client. The frontend never parses diffs — it renders per-file server HTML directly into carousel pages, fetches full text lazily, and posts interactions (viewed, comments, submit) back to REST endpoints that persist immediately.

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

`review-artifact` — emitted once after tool execution, metadata only (no full text, no full HTML):

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

### Existing Contract Changes (additive only)

- `ToolResultEvent` in `backend/src/schemas/events.ts`: add optional `artifact_id`
- `messages` table in `backend/src/schema.ts`: add nullable `artifactId` column

---

## Implementation Steps

### 1. Domain types + parser

- New `backend/src/schemas/diff-document.ts`: Zod schemas for `DiffDocument`, `DiffFile`, `DiffHunk`, `DiffLine`, `ReviewComment`.
- New `backend/src/services/diff-parser.ts`: parse unified diff text into typed model; generate stable IDs; build `fullTextLine` mapping.

### 2. Full-text resolver

- New `backend/src/services/diff-fulltext.ts`: resolve post-change file content from git blobs (staged → index, unstaged → worktree, commit → tree blob) using `runGit` from `backend/src/tools/git-utils.ts`.
- Cap at max bytes, mark binary as unavailable.

### 3. HTML renderer

- New `backend/src/services/diff-render.ts`: walk `DiffDocument` model, emit one escaped HTML fragment per `DiffFile` with stable `data-line-id`/`data-file-id` attributes, CSS class per line kind.
- Each file gets its own `html` string — carousel maps 1:1 (page N = `files[N].html`).
- No raw tool text in output.

### 4. Persistence

- Extend `backend/src/schema.ts` with `review_artifacts`, `artifact_files`, `review_comments` tables + nullable `artifactId` on `messages`.
- Additive DDL in `backend/src/db.ts`.
- New `backend/src/services/artifacts.ts`: CRUD for artifacts, viewed toggle, comment management, status transitions.

### 5. Agent integration

- Update `backend/src/services/agent.ts`: after `git_diff`/`git_show` execution, invoke parser → full-text resolver → renderer → persist artifact → set `artifact_id` on tool message → yield `review-artifact` SSE event alongside existing `tool-result`.

### 6. Event/API contracts

- Extend `backend/src/schemas/events.ts` with `ReviewArtifactEvent`.
- Extend `backend/src/schemas/api.ts` with artifact response types.
- Add optional `artifact_id` to `ToolResultEvent`.

### 7. Artifact routes

- New `backend/src/routes/artifacts.ts` with endpoints above.
- Mount in `backend/src/index.ts`.

### 8. Frontend data layer

- Add `review-artifact` handler in `frontend/src/sse.ts`.
- Add artifact signal/store in `frontend/src/store.ts`.
- Add fetch helpers in `frontend/src/api-client.ts` for artifact detail, full text, viewed, comments, submit.
- Wire live + replay in `frontend/src/streaming.ts`.

### 9. Layer 1: Changeset Card

- New `frontend/src/components/ChangesetCard.tsx`: client-rendered from artifact metadata signal (title, file tree with stats, viewed indicators, "Review next" button, status line). No server HTML — this is simple structured data that the client builds into DOM directly.
- Displayed inline in chat via `frontend/src/components/MessageBubble.tsx` when message has `artifact_id`.

### 10. Layer 2: Review Overlay

- New `frontend/src/components/ReviewOverlay.tsx`: full-screen carousel reusing `attachSwipeHandler` from `frontend/src/gestures.ts`.
- Per-file page renders `file.html` via `innerHTML` — one carousel page per file, zero client-side diff parsing. This is the only place server-rendered HTML is used; Layer 1 (changeset card) is entirely client-rendered from metadata.
- Bottom bar with viewed checkbox + comment input.
- Long-press for line comments.
- Auto-mark viewed on swipe-past.
- Final page is review summary with submit gating.

### 11. Submit flow

- `POST /api/artifacts/:id/submit` collects all comments as structured digest, sends to agent as a user message, updates artifact `status`, closes overlay, and updates changeset card state.

---

## Verification

- **Parser + renderer**: unit tests on sample unified diffs in new `backend/tests/diff-parser.test.ts` and `backend/tests/diff-render.test.ts`.
- **Artifact service**: CRUD + status + comment tests in new `backend/tests/artifacts.test.ts`.
- **Agent integration**: extend `backend/tests/agent.test.ts` to assert artifact creation on `git_diff`/`git_show`.
- **SSE contract**: extend `backend/tests/chat.test.ts` for `review-artifact` event emission.
- **End-to-end**: stream a `git_diff`, verify artifact SSE, reload session and confirm replay includes artifact, open overlay, toggle viewed, add comment, submit review.

---

## Locked Decisions

| Decision | Choice |
|----------|--------|
| SSE delivery | Dedicated `review-artifact` event, metadata only |
| Artifact linkage | Nullable `artifactId` on `messages` table |
| HTML storage | Persist rendered HTML per file on `DiffFile` rows |
| Full text | Post-change only, from git blobs, stored per file, fetched lazily |
| Interactions | Viewed + comments persisted immediately via REST |
| Scope | `git_diff` and `git_show` only |
