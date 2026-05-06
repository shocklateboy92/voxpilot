/**
 * Chat input form — message textarea + send/stop button.
 *
 * The textarea is never disabled so it retains focus across streaming.
 * The submit handler guards on `isStreaming()` to prevent sending while
 * the agent is responding. During streaming the send button transforms
 * into a stop button that aborts the current generation.
 */

import ArrowUp from "lucide-solid/icons/arrow-up";
import Square from "lucide-solid/icons/square";
import { isStreaming } from "../navigation";
import { abortCurrentSession, sendUserMessage } from "../streaming";

export interface ChatInputProps {
  /** Optional callback fired after a message is successfully submitted. */
  onSend?: () => void;
}

export function ChatInput(props: ChatInputProps) {
  function handleSubmit(
    e: SubmitEvent & { currentTarget: HTMLFormElement },
  ): void {
    e.preventDefault();
    if (isStreaming()) return;

    const textarea = e.currentTarget.elements.namedItem("message");
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    const value = textarea.value.trim();
    if (!value) return;

    textarea.value = "";
    textarea.style.height = "auto";
    void sendUserMessage(value);
    props.onSend?.();
  }

  function handleKeyDown(
    e: KeyboardEvent & { currentTarget: HTMLTextAreaElement },
  ): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  function handleAutoResize(
    e: InputEvent & { currentTarget: HTMLTextAreaElement },
  ): void {
    e.currentTarget.style.height = "auto";
    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
  }

  function handleStopClick(): void {
    void abortCurrentSession();
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
      {isStreaming() ? (
        <button
          type="button"
          class="btn btn-icon btn-stop"
          aria-label="Stop generating"
          onClick={handleStopClick}
        >
          <Square size={12} />
        </button>
      ) : (
        <button
          type="submit"
          class="btn btn-primary btn-icon"
          aria-label="Send"
        >
          <ArrowUp size={18} />
        </button>
      )}
    </form>
  );
}
