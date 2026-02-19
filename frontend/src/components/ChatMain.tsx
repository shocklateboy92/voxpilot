/**
 * Main chat area — messages + input form.
 *
 * Handles swipe gestures for mobile session navigation and
 * auto-scrolls during streaming via a scroll sentinel.
 */

import { For, Show, createEffect, createSignal, onMount, onCleanup } from "solid-js";
import {
  messages,
  streamingText,
  streamingToolCalls,
  isStreaming,
  errorMessage,
  swipeOffset,
  setSwipeOffset,
  sessions,
  activeIndex,
  pendingConfirm,
} from "../store";
import { sendUserMessage } from "../streaming";
import { navigateNext, navigatePrev } from "../sessions";
import { attachSwipeHandler } from "../gestures";
import { MessageBubble } from "./MessageBubble";
import { StreamingBubble } from "./StreamingBubble";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolConfirmBlock } from "./ToolConfirmBlock";

export function ChatMain() {
  let messagesRef: HTMLDivElement | undefined;
  let scrollSentinel: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  // Only animate the snap-back on cancelled swipes, not committed navigations
  const [animateSnap, setAnimateSnap] = createSignal(false);

  // Auto-scroll when messages change or streaming text updates
  createEffect(() => {
    // Track these signals to re-run when they change
    messages();
    streamingText();
    streamingToolCalls();
    errorMessage();
    pendingConfirm();

    // Scroll to bottom
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
        throw new Error("Component mounted without messagesRef reference being set");
    }

    const cleanup = attachSwipeHandler(messagesRef, {
      onSwipeMove(deltaX) {
        setAnimateSnap(false);
        // Dampened rubber-band: cap at ~60px with sqrt falloff
        const damped = Math.sign(deltaX) * Math.min(Math.sqrt(Math.abs(deltaX)) * 5, 100);
        setSwipeOffset(damped);
      },
      onSwipeLeft() {
        // Committed swipe — reset instantly (content will change)
        setAnimateSnap(false);
        setSwipeOffset(0);
        if (activeIndex() < sessions().length - 1) {
          navigateNext();
        }
      },
      onSwipeRight() {
        // Committed swipe — reset instantly (content will change)
        setAnimateSnap(false);
        setSwipeOffset(0);
        if (activeIndex() > 0) {
          navigatePrev();
        }
      },
      onSwipeCancel() {
        // Animate the snap-back to rest position
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

  // Derive whether arrows should show and their opacity from swipeOffset
  const showLeftArrow = () => {
    const off = swipeOffset();
    return off > 0 && activeIndex() > 0;
  };
  const showRightArrow = () => {
    const off = swipeOffset();
    return off < 0 && activeIndex() < sessions().length - 1;
  };
  const arrowOpacity = () => Math.min(Math.abs(swipeOffset()) / 60, 1);

  return (
    <div id="chat-main">
      {/* Swipe direction arrows */}
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
        onTransitionEnd={() => setAnimateSnap(false)}
      >
        <For each={messages()}>
          {(msg) => <MessageBubble message={msg} />}
        </For>

        {/* Live streaming tool calls */}
        <For each={streamingToolCalls()}>
          {(tc) => <ToolCallBlock call={tc} />}
        </For>

        {/* Tool confirmation prompt */}
        <Show when={pendingConfirm()}>
          {(confirm) => <ToolConfirmBlock confirm={confirm()} />}
        </Show>

        {/* Live streaming text */}
        <Show when={streamingText()}>
          {(text) => <StreamingBubble text={text()} />}
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
