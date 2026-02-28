/**
 * Main chat area — messages list with swipe gestures.
 */

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
import { navigateNext, navigatePrev } from "../sessions";
import {
  activeRootIndex,
  errorMessage,
  messages,
  pendingPermission,
  pendingQuestion,
  rootSessions,
  setSwipeOffset,
  swipeOffset,
} from "../store";
import { MessageBubble } from "./MessageBubble";
import { QuestionBlock } from "./QuestionBlock";
import { ToolConfirmBlock } from "./ToolConfirmBlock";

export function ChatMain() {
  let messagesRef: HTMLDivElement | undefined;
  let scrollSentinel: HTMLDivElement | undefined;

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

  // Auto-scroll when messages change or streaming updates
  createEffect(() => {
    void messages.length; // track store array changes
    errorMessage();
    pendingPermission();
    pendingQuestion();
    scrollSentinel?.scrollIntoView({ block: "end", behavior: "instant" });
  });

  // Swipe gesture handling
  onMount(() => {
    if (!messagesRef) {
      throw new Error(
        "Component mounted without messagesRef reference being set",
      );
    }

    const cleanup = attachSwipeHandler(messagesRef, {
      onSwipeMove(deltaX) {
        setAnimateSnap(false);
        pendingNav = null;
        const damped =
          Math.sign(deltaX) * Math.min(Math.sqrt(Math.abs(deltaX)) * 5, 100);
        setSwipeOffset(damped);
      },
      onSwipeLeft() {
        if (
          activeRootIndex() >= 0 &&
          activeRootIndex() < rootSessions().length - 1
        ) {
          pendingNav = navigateNext;
        }
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
      onSwipeRight() {
        if (activeRootIndex() > 0) {
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
    const off = swipeOffset();
    return off > 0 && activeRootIndex() > 0;
  };
  const showRightArrow = () => {
    const off = swipeOffset();
    return (
      off < 0 &&
      activeRootIndex() >= 0 &&
      activeRootIndex() < rootSessions().length - 1
    );
  };
  const arrowOpacity = () => Math.min(Math.abs(swipeOffset()) / 60, 1);

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

        <div ref={scrollSentinel} class="scroll-sentinel" />
      </div>
    </div>
  );
}
