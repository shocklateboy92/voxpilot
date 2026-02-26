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
      <button type="submit" class="btn" disabled={isStreaming()}>
        Send
      </button>
    </form>
  );
}
