/**
 * Main chat area — messages list with scroll management.
 *
 * Scroll behaviour is driven by `useScrollAnchor` (a reactive primitive).
 * The anchor instance is created at module level and exported so ChatView
 * can wire `onPaneMount` / `onScroll` into ContentShell.
 *
 * The scroll-to-bottom button is exported as `ChatScrollButton` for
 * ContentShell's overlay slot.
 */

import ChevronDown from "lucide-solid/icons/chevron-down";
import { createEffect, For, Show } from "solid-js";
import { activeSessionId } from "../navigation";
import { useScrollAnchor } from "../scroll-anchor";
import {
  consumeScrollPosition,
  pendingPermission,
  pendingQuestion,
  registerScrollTopGetter,
  store,
} from "../store";
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
 * for scroll-position restore and registers the scroll-top getter.
 * Pass to ContentShell's `onPaneMount`.
 */
export function chatPaneMount(el: HTMLDivElement): void {
  paneElRef = el;
  anchor.onPaneMount(el);
  registerScrollTopGetter(() => ({
    scrollTop: el.scrollTop,
    atBottom: anchor.isAtBottom(),
  }));
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

export function ChatMain() {
  let contentRef: HTMLDivElement | undefined;

  // Auto-scroll / restore when messages change or session switches.
  createEffect(() => {
    // Reactive dependencies: track message count & prompt state so we
    // re-run whenever content changes.
    const len = store.messages.length;
    store.errorMessage;
    pendingPermission();
    pendingQuestion();

    if (anchor.suppressed()) return;

    const id = activeSessionId();
    if (id && len > 0) {
      const saved = consumeScrollPosition(id);
      if (saved !== undefined) {
        if (saved.atBottom) {
          anchor.scrollToBottomInstant();
        } else {
          anchor.setSuppressed(true);
          const top = saved.scrollTop;
          requestAnimationFrame(() => {
            paneElRef?.scrollTo({ top, behavior: "instant" });
            anchor.setSuppressed(false);
          });
        }
        return;
      }
    }

    if (anchor.isAtBottom()) {
      anchor.scrollToBottomInstant();
    }
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
