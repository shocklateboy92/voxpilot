import ArrowUp from "lucide-solid/icons/arrow-up";
import LoaderCircle from "lucide-solid/icons/loader-circle";
import Paperclip from "lucide-solid/icons/paperclip";
import Square from "lucide-solid/icons/square";
import { createEffect, createMemo, createUniqueId, For, Show } from "solid-js";
import type { PromptDraft } from "../../platform/prompt-files";
import { IconButton } from "../../ui/IconButton";
import { Textarea } from "../../ui/Textarea";
import { AttachmentStrip } from "./attachments/AttachmentStrip";
import { clipboardFiles } from "./attachments/attachment-input";
import { ATTACHMENT_ACCEPT } from "./attachments/attachment-policy";
import { ComposerForm } from "./ComposerForm";
import { composerDraft } from "./create-composer-draft";
import { defaultModelData, modelData } from "./model-utils";
import { selectedModel } from "./preferences";

export function MessageComposer(props: {
  sessionID?: string;
  disabled?: boolean;
  streaming?: boolean;
  onSend: (
    content: PromptDraft,
    sessionID: string | undefined,
  ) => Promise<boolean>;
  onStop?: () => void;
}) {
  let input: HTMLTextAreaElement | undefined;
  let picker: HTMLInputElement | undefined;
  const hintID = createUniqueId();
  const draft = createMemo(() => composerDraft(props.sessionID));
  const busy = () => Boolean(props.disabled) || draft().sending();
  const modelWarning = createMemo(() => {
    if (!draft().attachments().length) return undefined;
    const selected = selectedModel();
    const model = selected
      ? modelData()?.find(
          (entry) =>
            entry.providerID === selected.providerID &&
            entry.id === selected.id,
        )
      : defaultModelData();
    if (
      !model ||
      model.capabilities.input.some(
        (type) => type === "image" || type.startsWith("image/"),
      )
    )
      return undefined;
    return "OpenCode does not list image input for this model. The provider may reject this message.";
  });

  createEffect(() => {
    const value = draft().text();
    if (!input) return;
    input.value = value;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const current = draft();
    if (busy() || props.streaming) return;
    const submitted = current.snapshot();
    if (!submitted.text.trim() && submitted.attachments.length === 0) return;
    const sessionID = props.sessionID;
    const send = props.onSend;
    current.setSending(true);
    try {
      const accepted = await send(
        {
          text: submitted.text,
          files: submitted.attachments.map((entry) => entry.file),
        },
        sessionID,
      );
      if (accepted !== false) current.consume(submitted);
    } finally {
      current.setSending(false);
    }
  }

  return (
    <ComposerForm onSubmit={(event) => void submit(event)}>
      <Show when={draft().attachments().length}>
        <AttachmentStrip
          attachments={draft().attachments()}
          disabled={busy()}
          onRemove={(id) => draft().removeAttachment(id)}
        />
      </Show>
      <div id={hintID} aria-live="polite" class="text-left text-xs">
        <For each={draft().errors()}>
          {(error) => <p class="px-1 py-1 text-error">{error}</p>}
        </For>
        <Show when={modelWarning()}>
          {(warning) => <p class="px-1 py-1 text-warning">{warning()}</p>}
        </Show>
      </div>
      <div class="flex w-full min-w-0 items-end gap-1">
        <input
          ref={picker}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          aria-label="Attach images"
          class="hidden"
          disabled={busy()}
          onChange={(event) => {
            draft().addFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
        <IconButton
          variant="ghost"
          aria-label="Attach files"
          title="Attach images (PNG, JPEG, WebP, GIF; 10 MiB each, 20 MiB total)"
          disabled={busy()}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => picker?.click()}
        >
          <Paperclip size={18} />
        </IconButton>
        <Textarea
          ref={input}
          name="message"
          class="chat-input"
          variant="composer"
          data-composer-input
          aria-label="Message"
          aria-describedby={hintID}
          placeholder="Send a message..."
          autocomplete="off"
          autofocus
          rows={1}
          disabled={props.disabled}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onInput={(event) => draft().setText(event.currentTarget.value)}
          onPaste={(event) => {
            const files = clipboardFiles(event);
            if (!files.length) return;
            event.preventDefault();
            draft().addFiles(files);
            // Some clipboards contain both an image and a useful text caption.
            const text = event.clipboardData?.getData("text/plain");
            if (text) {
              const element = event.currentTarget;
              element.setRangeText(
                text,
                element.selectionStart,
                element.selectionEnd,
                "end",
              );
              draft().setText(element.value);
            }
          }}
        />
        <Show
          when={props.streaming}
          fallback={
            <IconButton
              type="submit"
              variant="primary"
              aria-label="Send"
              aria-busy={draft().sending()}
              disabled={busy()}
              onPointerDown={(event) => event.preventDefault()}
            >
              <Show when={draft().sending()} fallback={<ArrowUp size={18} />}>
                <LoaderCircle size={18} class="animate-spin" />
              </Show>
            </IconButton>
          }
        >
          <IconButton
            variant="stop"
            aria-label="Stop generating"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => props.onStop?.()}
          >
            <Square size={12} />
          </IconButton>
        </Show>
      </div>
    </ComposerForm>
  );
}
