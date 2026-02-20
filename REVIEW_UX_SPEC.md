# Inline Code Review — UX Spec

> **Status: V1 implemented + post-V1 enhancements.** Changeset card, review
> overlay carousel, file-level comments, viewed tracking, submit flow, and
> full-file view toggle (with diff highlights and deletion interleaving) are
> all functional. See "What's deferred" at the bottom for remaining UX work.

Mobile-first code review experience embedded in the chat flow.

---

## Layer 1: Changeset Card (inline in chat)

A compact card rendered inline in the message stream when the agent proposes file changes.

### Content

- **Changeset title** — agent-generated summary (e.g. "Add error handling to auth flow")
- **File tree** — directory-grouped list with indentation, each row showing:
  - File path (indented under its directory)
  - Diff stats (`+12 −3`)
  - Viewed indicator: `●` viewed / `○` not yet
- **"Review next" button** — prominent, always targets the first un-viewed file
  - Label updates dynamically (e.g. "▶ Review next (middleware.ts)")
  - Once all files viewed, changes to "View summary"
- **Status line** — e.g. `2/3 viewed`

### Interactions

- **Tap a file** → opens the full-screen review overlay, jumping directly to that file's carousel page
- **Tap "Review next"** → opens the overlay at the first un-viewed file

```
┌─────────────────────────────────────┐
│ 🔀 Add error handling to auth flow  │
│                                     │
│  src/                               │
│    auth.ts          +12 −3    ●     │
│    middleware.ts     +4 −1    ○     │
│  tests/                             │
│    auth.test.ts     +28 −0    ○     │
│                                     │
│  ┌─────────────────────────────────┐│
│  │  ▶ Review next (middleware.ts) ││
│  └─────────────────────────────────┘│
│                  1/3 viewed         │
└─────────────────────────────────────┘
```

---

## Layer 2: Full-Screen Review Overlay

Opened by tapping a file or "Review next" in the changeset card. Takes over the full viewport (slide-up sheet or full-screen route).

### File Carousel (horizontal swipe)

- Each page is **one file's unified diff**, syntax highlighted, vertically scrollable
- Horizontal swipe navigates between files (reuses existing `attachSwipeHandler` from `gestures.ts`)
- **Page indicator** at the top: file name + position (e.g. `auth.ts  1/3`)
  - Tapping the indicator reveals a jump-to-file list
- Final page (after the last file) is the **Review Summary** page
- Diff style: **always unified** (single column), with toggle to full-file view
- **View toggle**: 📄/± button in the header switches between chunk view (hunks only) and full-file view (complete file with diff highlights and interleaved deletions). Only shown when full-file HTML is available.

### Bottom Bar (persistent, per file)

Anchored to the bottom of the viewport on each file page.

```
┌─────────────────────────────────────┐
│ 💬 2 comments          ☑ Viewed     │
│ ┌─────────────────────────────────┐ │
│ │  Add comment to this file...    │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

- **"Viewed" checkbox** — marks the file as reviewed. Updates the changeset card in Layer 1.
- **Auto-mark on swipe**: swiping past a file automatically marks it as viewed. The checkbox remains available to toggle/un-mark.
- **Comment count** — tapping expands/scrolls to show existing file-level comments
- **Text input** — quick-add a file-level comment

### Line-Level Comments (deferred)

- **Long-press a line** → line highlights, a comment input appears anchored below that line (slides up as a bottom sheet on narrow screens)
- Comments stored with file path + line number
- Existing line comments shown as inline `💬` markers in the gutter — tapping expands them

> **Implementation note**: The DOM has stable `data-line-id` attributes and the
> backend supports `lineId`/`lineNumber` on comments, but the long-press gesture
> and inline gutter markers are not yet wired.

### Review Summary (final carousel page)

```
┌─────────────────────────────────────┐
│         Review Summary              │
│                                     │
│  ✅ src/auth.ts          (viewed)   │
│     └ L23: "use guard clause"       │
│     └ file: "looks good"            │
│  ⚠️ src/middleware.ts   (not viewed)│
│  ✅ tests/auth.test.ts   (viewed)   │
│                                     │
│  ┌─────────────────────────────────┐│
│  │     Submit Review               ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │     Back to chat                ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

- Lists all files with viewed/not-viewed status
- Shows all comments (file-level and line-level) as a digest
- Tapping an un-viewed file swipes back to that file's carousel page
- **Submit button disabled** until every file is marked as viewed

### Submit Behavior

- On submit, **all comments are sent back to the agent as a single structured message** so it can revise the changeset
- The overlay closes and the inline changeset card updates to show "Changes requested" (if comments exist) or "Approved" (if no comments)
- The agent receives the comments and can respond with a revised changeset

---

## Data Model (conceptual)

```
Changeset {
  id: string
  title: string
  files: FileChange[]
  status: "pending" | "approved" | "changes_requested"
}

FileChange {
  path: string
  diff: UnifiedDiff
  additions: number
  deletions: number
  viewed: boolean
  comments: Comment[]
}

Comment {
  id: string
  filePath: string
  line: number | null      // null = file-level comment
  content: string
  timestamp: number
}
```

---

## Key Decisions

| Decision | Choice |
|----------|--------|
| Diff style | Unified (single column) with full-file toggle |
| Viewed marking | Auto-mark on swipe-past; explicit toggle to un-mark |
| Submit action | Send all comments to agent as structured message for revision |
| Navigation | Horizontal swipe carousel (reuse `attachSwipeHandler`) |
| Line comments | Long-press to add (deferred — backend supports it, UI not yet wired) |
| File comments | Text input in bottom bar |
