/**
 * Main chat area — messages list with scroll management.
 *
 * SwipeablePane is now owned by ContentShell; ChatMain receives
 * the scrollable container ref via the exported `chatPaneMount`
 * callback that the parent passes to ContentShell's onPaneMount.
 *
 * The scroll-to-bottom button is exposed separately via
 * `ChatScrollButton` for ContentShell's overlay slot.
 */

import ChevronDown from "lucide-solid/icons/chevron-down";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import {
  activeSessionId,
  consumeScrollPosition,
  errorMessage,
  messages,
  pendingPermission,
  pendingQuestion,
  registerScrollTopGetter,
} from "../store";
import { MessageBubble } from "./MessageBubble";
import { QuestionBlock } from "./QuestionBlock";
import { ToolConfirmBlock } from "./ToolConfirmBlock";

/**
 * Signal holding the SwipeablePane's scrollable container element.
 * Set by `chatPaneMount` (passed to ContentShell's `onPaneMount`),
 * consumed reactively inside ChatMain.
 */
const [paneEl, setPaneEl] = createSignal<HTMLDivElement | undefined>();

/** Pass to ContentShell's `onPaneMount` when rendering ChatMain. */
export function chatPaneMount(el: HTMLDivElement): void {
  setPaneEl(el);
}

const AT_BOTTOM_THRESHOLD = 50;
const [isAtBottom, setIsAtBottom] = createSignal(true);

/** Floating scroll-to-bottom button — render in ContentShell's overlay slot. */
export function ChatScrollButton() {
  function scrollToBottom(): void {
    const el = paneEl();
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  return (
    <Show when={!isAtBottom()}>
      <button
        class="btn btn-icon scroll-to-bottom"
        onClick={scrollToBottom}
        aria-label="Scroll to bottom"
      >
        <ChevronDown size={20} />
      </button>
    </Show>
  );
}

export function ChatMain() {
  let contentRef: HTMLDivElement | undefined;

  // While a scroll-position restore is in flight (waiting for rAF),
  // suppress all auto-scrolling so later effect runs don't clobber it.
  let restoring = false;

  // Auto-scroll when messages change, respecting saved scroll position
  // and whether the user has scrolled up.
  createEffect(() => {
    const el = paneEl();
    const len = messages.length;
    errorMessage();
    pendingPermission();
    pendingQuestion();

    if (!el || restoring) return;

    const id = activeSessionId();
    if (id && len > 0) {
      const saved = consumeScrollPosition(id);
      if (saved !== undefined) {
        if (saved.atBottom) {
          el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
          setIsAtBottom(true);
        } else {
          restoring = true;
          const top = saved.scrollTop;
          requestAnimationFrame(() => {
            el.scrollTo({ top, behavior: "instant" });
            setIsAtBottom(false);
            restoring = false;
          });
        }
        return;
      }
    }

    if (isAtBottom()) {
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    }
  });

  // Wire up scroll tracking and resize observer when pane element is available.
  createEffect(() => {
    const el = paneEl();
    if (!el) return;

    registerScrollTopGetter(() => {
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_THRESHOLD;
      return { scrollTop: el.scrollTop, atBottom };
    });

    const handleScroll = () => {
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_THRESHOLD;
      setIsAtBottom(atBottom);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    onCleanup(() => el.removeEventListener("scroll", handleScroll));

    let lastScrollHeight = el.scrollHeight;
    const resizeObserver = new ResizeObserver(() => {
      if (restoring) return;
      const grew = el.scrollHeight > lastScrollHeight;
      lastScrollHeight = el.scrollHeight;
      if (grew && isAtBottom()) {
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
      }
    });
    if (contentRef) resizeObserver.observe(contentRef);
    onCleanup(() => resizeObserver.disconnect());
  });

  return (
    <div ref={contentRef} class="messages-content">
      <For each={messages}>{(msg) => <MessageBubble msg={msg} />}</For>

      {/* Permission prompt */}
      <Show when={pendingPermission()}>
        {(perm) => <ToolConfirmBlock permission={perm()} />}
      </Show>

      {/* Question prompt */}
      <Show when={pendingQuestion()}>
        {(req) => <QuestionBlock request={req()} />}
      </Show>

      {/* Error display */}
      <Show when={errorMessage()}>
        {(msg) => <div class="message error">{msg()}</div>}
      </Show>

      <div class="scroll-sentinel" />
    </div>
  );
}
