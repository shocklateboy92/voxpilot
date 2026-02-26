/**
 * Main chat area — messages + input form.
 */

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
  isStreaming,
  messages,
  pendingPermission,
  pendingQuestion,
  rootSessions,
  setSwipeOffset,
  swipeOffset,
} from "../store";
import { sendUserMessage } from "../streaming";
import { MessageBubble } from "./MessageBubble";
import { QuestionBlock } from "./QuestionBlock";
import { ToolConfirmBlock } from "./ToolConfirmBlock";

export function ChatMain() {
  let messagesRef: HTMLDivElement | undefined;
  let scrollSentinel: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

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

  // Focus input when streaming finishes
  createEffect(() => {
    if (!isStreaming()) {
      inputRef?.focus();
    }
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

  function handleSubmit(e: SubmitEvent): void {
    e.preventDefault();
    const value = inputRef?.value.trim();
    if (!value || isStreaming()) return;
    if (inputRef) {
      inputRef.value = "";
    }
    void sendUserMessage(value);
  }

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
    <div id="chat-main">
      <div
        class="swipe-arrow swipe-arrow-left"
        style={{ opacity: showLeftArrow() ? arrowOpacity() : 0 }}
        aria-hidden="true"
      >
        ‹
      </div>
      <div
        class="swipe-arrow swipe-arrow-right"
        style={{ opacity: showRightArrow() ? arrowOpacity() : 0 }}
        aria-hidden="true"
      >
        ›
      </div>
      <div
        id="messages"
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

      <form id="chat-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          id="chat-input"
          type="text"
          placeholder="Send a message…"
          autocomplete="off"
          disabled={isStreaming()}
        />
        <button type="submit" class="btn" disabled={isStreaming()}>
          Send
        </button>
      </form>
    </div>
  );
}
