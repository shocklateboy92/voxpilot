/**
 * Chat input form — message textarea + send button.
 */

import { createEffect } from "solid-js";
import { isStreaming } from "../store";
import { sendUserMessage } from "../streaming";

/** Shared ref so other components (ChatMain) can focus the input. */
let inputEl: HTMLTextAreaElement | undefined;

export function focusChatInput(): void {
  inputEl?.focus();
}

export function ChatInput() {
  function handleSubmit(e: SubmitEvent): void {
    e.preventDefault();
    const value = inputEl?.value.trim();
    if (!value || isStreaming()) return;
    if (inputEl) {
      inputEl.value = "";
      inputEl.style.height = "auto";
    }
    void sendUserMessage(value);
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const form = inputEl?.closest("form");
      if (form) {
        form.requestSubmit();
      }
    }
  }

  function handleAutoResize(): void {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = `${inputEl.scrollHeight}px`;
  }

  // Focus input when streaming finishes
  createEffect(() => {
    if (!isStreaming()) {
      inputEl?.focus();
    }
  });

  return (
    <form id="chat-form" onSubmit={handleSubmit}>
      <textarea
        ref={inputEl}
        id="chat-input"
        placeholder="Send a message..."
        autocomplete="off"
        disabled={isStreaming()}
        rows={1}
        onKeyDown={handleKeyDown}
        onInput={handleAutoResize}
      />
      <button
        type="submit"
        class="btn btn-icon"
        disabled={isStreaming()}
        aria-label="Send"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          width="18"
          height="18"
          aria-hidden="true"
        >
          <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405z" />
        </svg>
      </button>
    </form>
  );
}
