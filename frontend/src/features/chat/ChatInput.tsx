import { activeSessionId, isStreaming } from "../../app/navigation";
import { abortCurrentSession, sendUserMessage } from "../../app/streaming";
import type { PromptDraft } from "../../platform/prompt-files";
import { MessageComposer } from "./MessageComposer";

export interface ChatInputProps {
  onSend?: () => void;
}

export function ChatInput(props: ChatInputProps) {
  async function send(content: PromptDraft, sessionID: string | undefined) {
    const accepted = await sendUserMessage(content, sessionID);
    if (accepted) props.onSend?.();
    return accepted;
  }
  return (
    <MessageComposer
      sessionID={activeSessionId()}
      streaming={isStreaming()}
      onStop={() => void abortCurrentSession()}
      onSend={send}
    />
  );
}
