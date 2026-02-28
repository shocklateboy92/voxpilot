/**
 * Main chat area — messages list with swipe gestures.
 */

import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { attachSwipeHandler } from "../gestures";
import { canNavigateNext, canNavigatePrev, navigateNext, navigatePrev } from "../sessions";
import {
  activeSessionId,
  consumeScrollPosition,
  errorMessage,
  messages,
  pendingPermission,
  pendingQuestion,
  registerScrollTopGetter,
  setSwipeOffset,
  swipeOffset,
} from "../store";
import { MessageBubble } from "./MessageBubble";
import { QuestionBlock } from "./QuestionBlock";
import { ToolConfirmBlock } from "./ToolConfirmBlock";

export function ChatMain() {
  let messagesRef: HTMLDivElement | undefined;

  const [animateSnap, setAnimateSnap] = createSignal(false);
  let pendingNav: (() => void) | null = null;

  function handleTransitionEnd(): void {
    setAnimateSnap(false);
    if (pendingNav) {
      const nav = pendingNav;
      pendingNav = null;
      nav();
    }
  }

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

  // Swipe gesture handling
  onMount(() => {
    if (!messagesRef) {
      throw new Error(
        "Component mounted without messagesRef reference being set",
      );
    }

    // Provide a read-only callback for the store to capture scroll state
    registerScrollTopGetter(() => {
      const el = messagesRef;
      if (!el) return { scrollTop: 0, atBottom: true };
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_THRESHOLD;
      return { scrollTop: el.scrollTop, atBottom };
    });

    // Track whether the user is scrolled to the bottom
    const handleScroll = () => {
      const el = messagesRef;
      if (!el) return;
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_THRESHOLD;
      setIsAtBottom(atBottom);
    };
    messagesRef.addEventListener("scroll", handleScroll, { passive: true });
    onCleanup(() => messagesRef?.removeEventListener("scroll", handleScroll));

    const cleanup = attachSwipeHandler(messagesRef, {
      onSwipeMove(deltaX) {
        setAnimateSnap(false);
        pendingNav = null;
        const damped =
          Math.sign(deltaX) * Math.min(Math.sqrt(Math.abs(deltaX)) * 5, 100);
        setSwipeOffset(damped);
      },
      onSwipeLeft() {
        if (canNavigateNext()) {
          pendingNav = navigateNext;
        }
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
      onSwipeRight() {
        if (canNavigatePrev()) {
          pendingNav = navigatePrev;
        }
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
      onSwipeCancel() {
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
    });

    onCleanup(cleanup);
  });

  const showLeftArrow = () => {
    return swipeOffset() > 0 && canNavigatePrev();
  };
  const showRightArrow = () => {
    return swipeOffset() < 0 && canNavigateNext();
  };
  const arrowOpacity = () => Math.min(Math.abs(swipeOffset()) / 60, 1);

  function scrollToBottom(): void {
    if (messagesRef) {
      messagesRef.scrollTo({ top: messagesRef.scrollHeight, behavior: "smooth" });
    }
  }

  return (
    <div class="chat-main">
      <div
        class="swipe-arrow swipe-arrow-left"
        style={{ opacity: showLeftArrow() ? arrowOpacity() : 0 }}
        aria-hidden="true"
      >
        <ChevronLeft size={24} />
      </div>
      <div
        class="swipe-arrow swipe-arrow-right"
        style={{ opacity: showRightArrow() ? arrowOpacity() : 0 }}
        aria-hidden="true"
      >
        <ChevronRight size={24} />
      </div>
      <Show when={!isAtBottom()}>
        <button
          class="btn btn-icon scroll-to-bottom"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={20} />
        </button>
      </Show>
      <div
        class="messages"
        ref={messagesRef}
        style={{
          transform: `translateX(${swipeOffset()}px)`,
          transition: animateSnap() ? "transform 200ms ease-out" : "none",
        }}
        onTransitionEnd={handleTransitionEnd}
      >
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
    </div>
  );
}
