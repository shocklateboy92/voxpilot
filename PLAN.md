# Frontend: Rewrite ChangesetCard + ReviewOverlay for ref-diff backend

## Context

The `show_diff` MCP tool backend is fully committed and working (commits `3b5c9bf`, `67bbef0`, `15f9678`). The frontend needs to render tool results inline and open a fullscreen diff overlay when the user clicks a file.

Two new components (`RefDiffBlock.tsx`, `RefDiffOverlay.tsx`) were created from scratch but should not exist — they duplicate the existing `ChangesetCard` and `ReviewOverlay` components. Those existing components are dead code from the pre-OpenCode era (not imported anywhere, broken CSS class references), so there's no compatibility to preserve. Rewrite them to work with the new ref-diff backend as their only data source.

The old `features/diff-tool` branch (commit `ec473cb`) has a `RefDiffOverlay` with a nice two-level UX (file list → click → single file diff → back button) that we want to preserve. That branch used an SSE event stream (`vox-events.ts`, `store.ts` `pendingRefDiff` signal) to push "show this diff" events from MCP to the frontend. We replaced that with a backend cache approach: the MCP tool caches structured data keyed by UUID, returns `[ref:UUID]` in the tool output text, and the frontend extracts the UUID from the `ToolPart.state.output` string and fetches the cache entry via `GET /api/review/ref-diff/cache/:id`.

## UX flow

1. LLM calls `voxpilot_show_diff` → MCP tool runs `git diff`, caches result, returns stat summary + `[ref:UUID]`
2. `MessageBubble` sees `part.tool === "voxpilot_show_diff"`, renders `<ChangesetCard part={part} />`
3. `ChangesetCard` shows spinner while tool is pending/running, then extracts UUID from output, fetches cache, renders file list with +/- stats
4. User clicks a file → `setReviewFile({from, to, filePath})` → `ReviewOverlay` opens fullscreen with the formatted diff from `POST /api/review/ref-diff`

## Files to delete

### `frontend/src/components/RefDiffBlock.tsx`

Remove entirely. Its functionality moves into the rewritten `ChangesetCard`.

### `frontend/src/components/RefDiffOverlay.tsx`

Remove entirely. Its functionality moves into the rewritten `ReviewOverlay`.

## Files to rewrite

### `frontend/src/components/ChangesetCard.tsx`

Rewrite as a tool-aware component. Current file is dead code with broken CSS class references (`file-path`, `stat-add`, `changeset-toggle` etc. — none match the actual CSS classes).

New behavior:

- **Props**: `{ part: ToolPart }` — receives the MCP tool part directly
- **Pending/running state**: Show a spinner, similar to `ToolPartBlock`
- **Completed state**: Extract `[ref:UUID]` from `state.output` using regex `/\[ref:([a-f0-9-]+)\]/`. Fetch cache entry from `GET /api/review/ref-diff/cache/:id` using `createResource`. Render compact file list with +/- stats.
- **Error state**: Show error text (from `state.error` or if `state.output` starts with `"Error:"`)
- **File click**: Call `setReviewFile({ from: cache.resolvedFrom, to: cache.resolvedTo, filePath })` to open the overlay. Use `resolvedFrom`/`resolvedTo` (pinned SHAs) for the fetch, but display `cache.from`/`cache.to` (symbolic names like HEAD, WORKTREE) in the header label.
- **No expand/collapse toggle**: The file list is always visible once loaded (unlike the old self-fetching ChangesetCard which had a toggle).
- **CSS classes**: Use the existing `changeset-card`, `changeset-file-row`, `changeset-file-path`, `changeset-file-stats`, `changeset-adds`, `changeset-dels` classes that already have styles in `style.css`.

Reference: The cache entry type is:

```ts
interface DiffCacheEntry {
  from: string; // symbolic ref name (e.g. "HEAD")
  to: string; // symbolic ref name (e.g. "WORKTREE")
  resolvedFrom: string; // pinned SHA or synthetic ref
  resolvedTo: string; // pinned SHA or synthetic ref
  path?: string; // optional path filter
  files: { file: string; additions: number; deletions: number }[];
}
```

### `frontend/src/components/ReviewOverlay.tsx`

Rewrite as the single overlay for ref-based diffs. Current file is dead code that fetches from the old `POST /api/review/format-diff` endpoint using OpenCode session IDs.

New behavior:

- **Signal**: Module-level `createSignal<ReviewRequest | null>(null)` where:
  ```ts
  interface ReviewRequest {
    from: string; // resolved ref (SHA or INDEX/WORKTREE)
    to: string; // resolved ref
    filePath: string; // file to show
  }
  ```
  Export the signal as `[reviewFile, setReviewFile]`.
- **Fetch**: `POST /api/review/ref-diff` with `{ from, to, filePath, printWidth }`. Returns `{ html: string }`.
- **Header**: Show file path + close button. Same layout as current.
- **Resize handling**: Same debounced `ResizeObserver` pattern as current — re-fetch on container resize to recalculate `printWidth`.
- **Close**: Set signal to null, clear diff HTML.
- **No session-based `markViewed()`**: Remove the `review-state.ts` import. The viewed/comment tracking was session-based and doesn't apply to ref diffs.
- **CSS**: Reuse existing `.review-overlay`, `.review-content`, `.review-header`, `.review-file-path`, `.review-close` (add CSS for `.review-close` since it doesn't exist — CSS only has `.review-close-btn`), `.review-loading`, `.review-diff` classes.

## Files to edit

### `frontend/src/components/MessageBubble.tsx`

Change the import from `RefDiffBlock` to `ChangesetCard`. The branching logic stays the same shape:

```tsx
import { ChangesetCard } from "./ChangesetCard";
// ...
<For each={toolParts()}>
  {(part) =>
    part.tool === "voxpilot_show_diff" ? (
      <ChangesetCard part={part} />
    ) : (
      <ToolPartBlock part={part} />
    )
  }
</For>;
```

### `frontend/src/components/ChatView.tsx`

Remove `RefDiffOverlay` import. Keep `ReviewOverlay` (which is the only overlay now). The JSX goes back to just `<ReviewOverlay />` with no `<RefDiffOverlay />`.

### `frontend/src/style.css`

1. **Remove** all `.ref-diff-*` rules (lines ~1640-1722) — these were for the now-deleted `RefDiffBlock`.
2. **Remove** `.review-ref-label` — no longer needed.
3. **Keep** `.review-file-path` and `.review-close` rules — still needed by `ReviewOverlay`.
4. **Keep** all existing `changeset-*` rules — reused by the new `ChangesetCard`.
5. **Add** a `.changeset-label` rule for the header label (e.g. "HEAD → WORKTREE"):
   ```css
   .changeset-label {
     font-family: var(--font-mono);
     font-size: 0.8rem;
     font-weight: 600;
     overflow: hidden;
     text-overflow: ellipsis;
     white-space: nowrap;
   }
   ```
6. **Add** a `.changeset-stats` rule for the "N files" count in the header:
   ```css
   .changeset-stats {
     color: var(--color-muted);
     font-size: 0.75rem;
     margin-left: auto;
     white-space: nowrap;
   }
   ```
7. **Add** `.changeset-error` and `.changeset-loading` rules:
   ```css
   .changeset-error {
     padding: 0.5rem 0.75rem;
     color: var(--color-error);
     font-size: 0.8rem;
   }
   .changeset-error pre {
     margin: 0;
     white-space: pre-wrap;
     word-break: break-word;
   }
   .changeset-loading {
     padding: 0.5rem 0.75rem;
     color: var(--color-muted);
     font-size: 0.8rem;
   }
   ```

### `frontend/src/api-client.ts`

Remove `fetchSessionDiff` function (dead code — was for OpenCode session diffs, used by the old `ChangesetCard`). Remove the `FileDiff` import from `@opencode-ai/sdk/v2/client` and from the re-export if nothing else uses it.

## Files left alone

- **All backend files** (`mcp.ts`, `routes/review.ts`, `services/git-utils.ts`, `index.ts`) — unchanged
- **`store.ts`** — no new signals needed; the overlay signal lives in `ReviewOverlay.tsx` as a module-level `createSignal`
- **`ToolPartBlock.tsx`** — unchanged, still handles all other tools
- **`review-state.ts`** — leave for now (dead code but not hurting anything)

## Backend endpoints (reference, no changes)

- `GET /api/review/ref-diff/cache/:id` — returns cached `DiffCacheEntry` (file list + refs)
- `GET /api/review/ref-diff/files?from=X&to=Y` — lists changed files between two refs
- `POST /api/review/ref-diff` — returns `{ html: string }` formatted diff for a single file
- `POST /api/review/format-diff` — old session-based endpoint (still exists, unused by new frontend)

## Verification

After all changes:

1. `bun run build` in `frontend/` — should succeed with no errors
2. Manual test: start the app, have the LLM call `voxpilot_show_diff`, verify:
   - Spinner shows while tool is running
   - File list appears with correct +/- stats when tool completes
   - Clicking a file opens the fullscreen diff overlay
   - Close button works
   - Resize re-renders the diff at correct width
