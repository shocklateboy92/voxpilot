/**
 * Main chat area — messages + input form.
 *
 * Handles swipe gestures for mobile session navigation and
 * auto-scrolls during streaming via a scroll sentinel.
 */

import { For, Show, createEffect, onMount, onCleanup } from "solid-js";
import {
  messages,
  streamingText,
  streamingToolCalls,
  isStreaming,
  errorMessage,
  swipeOffset,
  swipeAnimating,
  setSwipeOffset,
  setSwipeAnimating,
  sessions,
  activeIndex,
} from "../store";
import { sendUserMessage } from "../streaming";
import { navigateNext, navigatePrev } from "../sessions";
import { attachSwipeHandler } from "../gestures";
import { MessageBubble } from "./MessageBubble";
import { StreamingBubble } from "./StreamingBubble";
import { ToolCallBlock } from "./ToolCallBlock";

export function ChatMain() {
  let messagesRef: HTMLDivElement | undefined;
  let scrollSentinel: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  // Auto-scroll when messages change or streaming text updates
  createEffect(() => {
    // Track these signals to re-run when they change
    messages();
    streamingText();
    streamingToolCalls();
    errorMessage();

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
        // Dampen swipe if at boundary (no prev/next session)
        const idx = activeIndex();
        const len = sessions().length;
        const atStart = idx === 0 && deltaX > 0;
        const atEnd = idx === len - 1 && deltaX < 0;

        if (atStart || atEnd) {
          // Rubber-band effect: reduce movement to 30%
          setSwipeOffset(deltaX * 0.3);
        } else {
          setSwipeOffset(deltaX);
        }
      },
      onSwipeLeft() {
        const idx = activeIndex();
        if (idx < sessions().length - 1) {
          // Animate slide out to the left
          setSwipeAnimating(true);
          setSwipeOffset(-window.innerWidth);
          setTimeout(() => {
            navigateNext();
            setSwipeOffset(0);
            setSwipeAnimating(false);
          }, 250);
        } else {
          // Snap back
          setSwipeAnimating(true);
          setSwipeOffset(0);
          setTimeout(() => setSwipeAnimating(false), 250);
        }
      },
      onSwipeRight() {
        const idx = activeIndex();
        if (idx > 0) {
          // Animate slide out to the right
          setSwipeAnimating(true);
          setSwipeOffset(window.innerWidth);
          setTimeout(() => {
            navigatePrev();
            setSwipeOffset(0);
            setSwipeAnimating(false);
          }, 250);
        } else {
          // Snap back
          setSwipeAnimating(true);
          setSwipeOffset(0);
          setTimeout(() => setSwipeAnimating(false), 250);
        }
      },
      onSwipeCancel() {
        setSwipeAnimating(true);
        setSwipeOffset(0);
        setTimeout(() => setSwipeAnimating(false), 250);
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

  return (
    <div id="chat-main">
      <div
        id="messages"
        ref={messagesRef}
        style={{
          transform: `translateX(${swipeOffset()}px)`,
          transition: swipeAnimating() ? "transform 250ms ease-out" : "none",
        }}
      >
        <For each={messages()}>
          {(msg) => <MessageBubble message={msg} />}
        </For>

        {/* Live streaming tool calls */}
        <For each={streamingToolCalls()}>
          {(tc) => <ToolCallBlock call={tc} />}
        </For>

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
