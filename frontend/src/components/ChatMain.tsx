/**
 * Main chat area — messages + input form.
 */

import type { ToolPart } from "@opencode-ai/sdk/client";
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
  activeIndex,
  errorMessage,
  isStreaming,
  messages,
  pendingPermission,
  sessions,
  setSwipeOffset,
  streamingParts,
  streamingText,
  swipeOffset,
} from "../store";
import { sendUserMessage } from "../streaming";
import { MessageBubble } from "./MessageBubble";
import { StreamingBubble } from "./StreamingBubble";
import { ToolCallBlock } from "./ToolCallBlock";
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

  // Derived: filter streaming parts to just tool parts
  const streamingToolParts = () =>
    streamingParts().filter((p): p is ToolPart => p.type === "tool");

  // Auto-scroll when messages change or streaming text updates
  createEffect(() => {
    messages();
    streamingText();
    streamingParts();
    errorMessage();
    pendingPermission();
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
        if (activeIndex() < sessions().length - 1) {
          pendingNav = navigateNext;
        }
        setAnimateSnap(true);
        setSwipeOffset(0);
      },
      onSwipeRight() {
        if (activeIndex() > 0) {
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
    return off > 0 && activeIndex() > 0;
  };
  const showRightArrow = () => {
    const off = swipeOffset();
    return off < 0 && activeIndex() < sessions().length - 1;
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
        <For each={messages()}>{(msg) => <MessageBubble msg={msg} />}</For>

        {/* Live streaming tool calls */}
        <For each={streamingToolParts()}>
          {(part) => <ToolCallBlock part={part} />}
        </For>

        {/* Permission prompt */}
        <Show when={pendingPermission()}>
          {(perm) => <ToolConfirmBlock permission={perm()} />}
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
