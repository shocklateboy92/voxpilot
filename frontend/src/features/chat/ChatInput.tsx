import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import { Show } from "solid-js";
import {
  activeSession,
  activeSessionId,
  isStreaming,
} from "../../app/navigation";
import { abortCurrentSession, sendUserMessage } from "../../app/streaming";
import { client } from "../../platform/connection";
import type { PromptDraft } from "../../platform/prompt-files";
import { fetchVocabulary } from "../../platform/vocabulary";
import { IconButton } from "../../ui/IconButton";
import { composerDraft } from "./create-composer-draft";
import { MessageComposer } from "./MessageComposer";
import type { ReadingControls } from "./reading-controls";

export interface ChatInputProps {
  onSend?: () => void;
  readingControls?: ReadingControls;
}

export function ChatInput(props: ChatInputProps) {
  const reading = () => props.readingControls?.reading ?? false;
  const draft = () => composerDraft(activeSessionId());
  const hasDraft = () =>
    Boolean(
      draft().text() ||
        draft().attachments().length ||
        draft().references().length ||
        draft().recording(),
    );
  async function send(content: PromptDraft, sessionID: string | undefined) {
    const accepted = await sendUserMessage(content, sessionID);
    if (accepted && activeSessionId() === sessionID) {
      props.readingControls?.collapse();
      props.onSend?.();
    }
    return accepted;
  }
  return (
    <div
      class="flex min-w-0 max-w-[66rem] items-end gap-3"
      classList={{ "w-full flex-col": !reading() }}
    >
      <Show when={reading()}>
        <div class="flex items-center gap-2">
          <Show when={hasDraft()}>
            <span class="rounded-lg bg-surface px-2 py-1 text-xs text-muted">
              Draft
            </span>
          </Show>
          <IconButton
            size="lg"
            class="shadow-floating"
            aria-label="Expand controls"
            aria-expanded={false}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => props.readingControls?.expand()}
          >
            <SlidersHorizontal size={20} />
          </IconButton>
        </div>
      </Show>
      <MessageComposer
        readingControls={props.readingControls}
        sessionID={activeSessionId()}
        streaming={isStreaming()}
        onStop={() => void abortCurrentSession()}
        onSend={send}
        voiceDirectory={activeSession()?.location.directory}
        readVoiceVocabulary={(directory, signal) =>
          fetchVocabulary(directory, client, signal)
        }
      />
    </div>
  );
}
