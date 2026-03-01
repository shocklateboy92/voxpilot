/**
 * Main chat area — messages list with swipe gestures.
 */

import ChevronDown from "lucide-solid/icons/chevron-down";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { canNavigateNext, canNavigatePrev, navigateNext, navigatePrev } from "../sessions";
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
import { SwipeablePane } from "./SwipeablePane";
import { ToolConfirmBlock } from "./ToolConfirmBlock";

export function ChatMain() {
  let messagesRef: HTMLDivElement | undefined;
  let contentRef: HTMLDivElement | undefined;

  const AT_BOTTOM_THRESHOLD = 50;
  const [isAtBottom, setIsAtBottom] = createSignal(true);

  // While a scroll-position restore is in flight (waiting for rAF),
  // suppress all auto-scrolling so later effect runs don't clobber it.
  let restoring = false;

  // Auto-scroll when messages change, respecting saved scroll position
  // and whether the user has scrolled up.
  createEffect(() => {
    const len = messages.length;
    errorMessage();
    pendingPermission();
    pendingQuestion();

    if (restoring) return;

    const id = activeSessionId();
    if (id && len > 0) {
      const saved = consumeScrollPosition(id);
      if (saved !== undefined) {
        if (saved.atBottom) {
          messagesRef?.scrollTo({ top: messagesRef.scrollHeight, behavior: "instant" });
          setIsAtBottom(true);
        } else {
          // Defer until the browser has laid out the new message content,
          // otherwise scrollTop has no effect on a container that hasn't
          // been sized yet.
          restoring = true;
          const top = saved.scrollTop;
          requestAnimationFrame(() => {
            messagesRef?.scrollTo({ top, behavior: "instant" });
            setIsAtBottom(false);
            restoring = false;
          });
        }
        return;
      }
    }

    // Default: only auto-scroll if the user is already at the bottom
    if (isAtBottom()) {
      messagesRef?.scrollTo({ top: messagesRef.scrollHeight, behavior: "instant" });
    }
  });

  function handlePaneMount(el: HTMLDivElement): void {
    messagesRef = el;

    // Provide a read-only callback for the store to capture scroll state
    registerScrollTopGetter(() => {
      if (!messagesRef) return { scrollTop: 0, atBottom: true };
      const atBottom =
        messagesRef.scrollTop + messagesRef.clientHeight >= messagesRef.scrollHeight - AT_BOTTOM_THRESHOLD;
      return { scrollTop: messagesRef.scrollTop, atBottom };
    });

    // Track whether the user is scrolled to the bottom
    const handleScroll = () => {
      if (!messagesRef) return;
      const atBottom =
        messagesRef.scrollTop + messagesRef.clientHeight >= messagesRef.scrollHeight - AT_BOTTOM_THRESHOLD;
      setIsAtBottom(atBottom);
    };
    messagesRef.addEventListener("scroll", handleScroll, { passive: true });
    onCleanup(() => messagesRef?.removeEventListener("scroll", handleScroll));

    // Auto-scroll when content height grows (e.g. tool parts updating,
    // streaming text filling in) while the user is at the bottom.
    // The reactive effect only fires on messages.length changes; this
    // catches in-place content growth that doesn't add new messages.
    let lastScrollHeight = messagesRef.scrollHeight;
    const resizeObserver = new ResizeObserver(() => {
      if (!messagesRef || restoring) return;
      const grew = messagesRef.scrollHeight > lastScrollHeight;
      lastScrollHeight = messagesRef.scrollHeight;
      if (grew && isAtBottom()) {
        messagesRef.scrollTo({ top: messagesRef.scrollHeight, behavior: "instant" });
      }
    });
    if (contentRef) resizeObserver.observe(contentRef);
    onCleanup(() => resizeObserver.disconnect());
  }

  function scrollToBottom(): void {
    if (messagesRef) {
      messagesRef.scrollTo({ top: messagesRef.scrollHeight, behavior: "smooth" });
    }
  }

  return (
    <div class="chat-main">
      <Show when={!isAtBottom()}>
        <button
          class="btn btn-icon scroll-to-bottom"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={20} />
        </button>
      </Show>
      <SwipeablePane
        class="messages"
        canSwipeLeft={canNavigateNext}
        canSwipeRight={canNavigatePrev}
        onSwipeLeft={navigateNext}
        onSwipeRight={navigatePrev}
        onMount={handlePaneMount}
      >
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
      </SwipeablePane>
    </div>
  );
}
