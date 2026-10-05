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
import { isStreaming } from "../../app/navigation";
import { abortCurrentSession, sendUserMessage } from "../../app/streaming";
import { IconButton } from "../../ui/IconButton";
import { Textarea } from "../../ui/Textarea";
import { ComposerForm } from "./ComposerForm";

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
    <ComposerForm onSubmit={handleSubmit}>
      <Textarea
        name="message"
        class="chat-input"
        variant="composer"
        data-composer-input
        aria-label="Message"
        placeholder="Send a message..."
        autocomplete="off"
        autofocus
        rows={1}
        onKeyDown={handleKeyDown}
        onInput={handleAutoResize}
      />
      {isStreaming() ? (
        <IconButton
          type="button"
          variant="stop"
          aria-label="Stop generating"
          // Keep focus in the composer so keyboard/nav changes cannot move the button mid-click.
          onPointerDown={(event) => event.preventDefault()}
          onClick={handleStopClick}
        >
          <Square size={12} />
        </IconButton>
      ) : (
        <IconButton
          type="submit"
          variant="primary"
          aria-label="Send"
          onPointerDown={(event) => event.preventDefault()}
        >
          <ArrowUp size={18} />
        </IconButton>
      )}
    </ComposerForm>
  );
}
