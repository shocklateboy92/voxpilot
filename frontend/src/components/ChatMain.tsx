/**
 * Main chat area — messages list with scroll management.
 *
 * Scroll behaviour is driven by `useScrollAnchor` (a reactive primitive).
 * The anchor instance is created at module level and exported so ChatView
 * can wire `onPaneMount` / `onScroll` into ContentShell.
 *
 * The scroll-to-bottom button is exported as `ChatScrollButton` for
 * ContentShell's overlay slot.
 *
 * Scroll-position persistence across session switches is handled entirely
 * within this module via a single effect that tracks both activeSessionId
 * and store.messages — restoring scroll only after messages have loaded.
 */

import ChevronDown from "lucide-solid/icons/chevron-down";
import { createEffect, For, Show } from "solid-js";
import { activeSessionId, pendingPermission, pendingQuestion } from "../navigation";
import { useScrollAnchor } from "../scroll-anchor";
import { store } from "../store";
import { MessageBubble } from "./MessageBubble";
import { QuestionBlock } from "./QuestionBlock";
import { ToolConfirmBlock } from "./ToolConfirmBlock";

/**
 * Shared scroll-anchor instance for the chat pane.
 * ChatView wires `anchor.onPaneMount` and `anchor.onScroll` to ContentShell.
 */
export const anchor = useScrollAnchor();

/**
 * Module-level ref to the pane element, set by `chatPaneMount`.
 * Used for scroll-position restore (which needs a specific scrollTop,
 * not just "scroll to bottom").
 */
let paneElRef: HTMLDivElement | undefined;

/**
 * Thin wrapper around anchor.onPaneMount that also captures the element
 * for scroll-position restore.
 * Pass to ContentShell's `onPaneMount`.
 */
export function chatPaneMount(el: HTMLDivElement): void {
  paneElRef = el;
  anchor.onPaneMount(el);
}

/** Floating scroll-to-bottom button — render in ContentShell's overlay slot. */
export function ChatScrollButton() {
  return (
    <Show when={!anchor.isAtBottom()}>
      <button
        class="btn btn-icon scroll-to-bottom"
        onClick={anchor.scrollToBottom}
        aria-label="Scroll to bottom"
      >
        <ChevronDown size={20} />
      </button>
    </Show>
  );
}

// ── Scroll position persistence ──────────────────────────────────

interface SavedScrollState {
  scrollTop: number;
  atBottom: boolean;
}

const scrollPositions = new Map<string, SavedScrollState>();

function saveScrollPosition(sessionId: string | undefined): void {
  if (!sessionId || !paneElRef) return;
  scrollPositions.set(sessionId, {
    scrollTop: paneElRef.scrollTop,
    atBottom: anchor.isAtBottom(),
  });
}

function consumeScrollPosition(
  sessionId: string,
): SavedScrollState | undefined {
  const state = scrollPositions.get(sessionId);
  if (state !== undefined) scrollPositions.delete(sessionId);
  return state;
}

export function ChatMain() {
  let contentRef: HTMLDivElement | undefined;

  // ── Scroll position save/restore across session switches ──────
  //
  // Merged into a single effect that tracks both activeSessionId()
  // and store.messages reactively.
  //
  // When the session changes: save old position, prepare restore,
  // but return early — messages haven't loaded yet.
  //
  // When messages update for the current session and a restore is
  // pending: perform the restore against the correct DOM content.
  //
  // Auto-scroll on content growth is NOT handled here — the
  // ResizeObserver in useScrollAnchor already does that.

  let prevSessionId: string | undefined;
  let pendingRestore: SavedScrollState | undefined;
  let restorePending = false;

  createEffect(() => {
    const id = activeSessionId();
    store.messages.length; // reactive dep — re-run when messages are replaced

    if (id !== prevSessionId) {
      // Session changed — save old position, prepare restore
      saveScrollPosition(prevSessionId);
      // Clear any in-progress restore from a previous switch
      anchor.clearRestoreTarget();
      pendingRestore = id ? consumeScrollPosition(id) : undefined;
      restorePending = true;
      prevSessionId = id;
      return;
    }

    // Same session, messages updated — restore if pending
    if (!restorePending) return;
    restorePending = false;

    if (pendingRestore) {
      const saved = pendingRestore;
      pendingRestore = undefined;
      if (!saved.atBottom) {
        // Set the restore target — the ResizeObserver will keep scrolling
        // to this position on every content growth until the DOM is tall
        // enough to reach it.
        anchor.setRestoreTarget(saved.scrollTop);
      }
      // If saved.atBottom: no action needed — isAtBottom starts true,
      // so the ResizeObserver will keep it pinned as content renders.
    }
    // No saved position → default is at bottom (isAtBottom starts true).
  });

  // Wire up the content element for the ResizeObserver once mounted.
  createEffect(() => {
    if (contentRef) {
      anchor.observeContent(contentRef);
    }
  });

  return (
    <div ref={contentRef} class="messages-content">
      <For each={store.messages}>
        {(msg) => <MessageBubble msg={msg} />}
      </For>

      {/* Permission prompt */}
      <Show when={pendingPermission()}>
        {(perm) => <ToolConfirmBlock permission={perm()} />}
      </Show>

      {/* Question prompt */}
      <Show when={pendingQuestion()}>
        {(req) => <QuestionBlock request={req()} />}
      </Show>

      {/* Error display */}
      <Show when={store.errorMessage}>
        {(msg) => <div class="message error">{msg()}</div>}
      </Show>

      <div class="scroll-sentinel" />
    </div>
  );
}
