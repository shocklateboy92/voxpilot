/**
 * Chat input form — message textarea + send button.
 *
 * The textarea is never disabled so it retains focus across streaming.
 * The submit handler guards on `isStreaming()` to prevent sending while
 * the agent is responding; the send button is visually disabled as a cue.
 */

import ArrowUp from "lucide-solid/icons/arrow-up";
import { isStreaming } from "../store";
import { sendUserMessage } from "../streaming";

export interface ChatInputProps {
  /** Optional callback fired after a message is successfully submitted. */
  onSend?: () => void;
}

export function ChatInput(props: ChatInputProps) {
  function handleSubmit(e: SubmitEvent & { currentTarget: HTMLFormElement }): void {
    e.preventDefault();
    const textarea = e.currentTarget.elements.namedItem("message");
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    const value = textarea.value.trim();
    if (!value || isStreaming()) return;

    textarea.value = "";
    textarea.style.height = "auto";
    void sendUserMessage(value);
    props.onSend?.();
  }

  function handleKeyDown(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  function handleAutoResize(e: InputEvent & { currentTarget: HTMLTextAreaElement }): void {
    e.currentTarget.style.height = "auto";
    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
  }

  return (
    <form class="chat-form" onSubmit={handleSubmit}>
      <textarea
        name="message"
        class="chat-input"
        placeholder="Send a message..."
        autocomplete="off"
        autofocus
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
        <ArrowUp size={18} />
      </button>
    </form>
  );
}
