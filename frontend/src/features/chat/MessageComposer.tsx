import ArrowUp from "lucide-solid/icons/arrow-up";
import Keyboard from "lucide-solid/icons/keyboard";
import LoaderCircle from "lucide-solid/icons/loader-circle";
import Mic from "lucide-solid/icons/mic";
import Paperclip from "lucide-solid/icons/paperclip";
import Square from "lucide-solid/icons/square";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  Show,
} from "solid-js";
import type { PromptDraft } from "../../platform/prompt-files";
import { speechConnection } from "../../platform/speech";
import type { fetchVocabulary } from "../../platform/vocabulary";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Textarea } from "../../ui/Textarea";
import { AttachmentStrip } from "./attachments/AttachmentStrip";
import { clipboardFiles } from "./attachments/attachment-input";
import { ATTACHMENT_ACCEPT } from "./attachments/attachment-policy";
import { ComposerForm } from "./ComposerForm";
import { composerDraft } from "./create-composer-draft";
import { createVoiceTake } from "./create-voice-take";
import { defaultModelData, modelData } from "./model-utils";
import { PastedReferences, PasteReferenceButton } from "./PastedReferences";
import { composerMode, selectedModel, setComposerMode } from "./preferences";
import { type RecordedAudio, VoiceRecorder } from "./VoiceRecorder";
import { VoiceTranscription } from "./VoiceTranscription";

export function MessageComposer(props: {
  sessionID?: string;
  disabled?: boolean;
  streaming?: boolean;
  onSend: (
    content: PromptDraft,
    sessionID: string | undefined,
  ) => Promise<boolean>;
  onStop?: () => void;
  voiceDirectory?: string;
  readVoiceVocabulary?: (
    directory: string,
    signal: AbortSignal,
  ) => ReturnType<typeof fetchVocabulary>;
}) {
  let input: HTMLTextAreaElement | undefined;
  let picker: HTMLInputElement | undefined;
  const hintID = createUniqueId();
  const draft = createMemo(() => composerDraft(props.sessionID));
  const [recordingActive, setRecordingActive] = createSignal(false);
  let mounted = true;
  onCleanup(() => {
    mounted = false;
  });
  function captureRecording() {
    const current = draft();
    current.setRecording(undefined);
    const sessionID = props.sessionID;
    const directory = props.voiceDirectory;
    const read = props.readVoiceVocabulary;
    const send = props.onSend;
    const take = createVoiceTake(current, {
      owned: () =>
        mounted &&
        props.sessionID === sessionID &&
        props.voiceDirectory === directory,
      vocabulary: (signal) => {
        if (!directory || !read)
          throw new Error("The original project's vocabulary is unavailable.");
        return read(directory, signal);
      },
      send: (content) => send(content, sessionID),
    });
    return (audio: RecordedAudio) => {
      const recording = current.setRecording({ ...audio, voice: take });
      if (!recording) return;
      take.attach(recording);
      void take.transcribe();
    };
  }
  const pendingRecording = () => {
    const recording = draft().recording();
    return recording && recording.voice.phase() !== "ready";
  };
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
    if (composerMode() !== "text") return;
    if (!input) return;
    input.value = value;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const current = draft();
    if (busy() || props.streaming || recordingActive() || pendingRecording())
      return;
    const submitted = current.snapshot();
    const recording = current.recording();
    if (
      !submitted.text.trim() &&
      submitted.attachments.length === 0 &&
      submitted.references.length === 0
    )
      return;
    const sessionID = props.sessionID;
    const send = props.onSend;
    current.setSending(true);
    try {
      const accepted = await send(
        {
          text: [
            submitted.text,
            ...submitted.references.map(
              (entry) => `Pasted item ${entry.number}:\n${entry.text}`,
            ),
          ]
            .filter(Boolean)
            .join("\n\n"),
          files: submitted.attachments.map((entry) => entry.file),
        },
        sessionID,
      );
      if (accepted !== false) {
        current.consume(submitted);
        if (recording && current.recording() === recording)
          current.setRecording(undefined);
      }
    } finally {
      current.setSending(false);
    }
  }

  return (
    <ComposerForm onSubmit={(event) => void submit(event)}>
      <Show when={draft()} keyed>
        {(current) => <PastedReferences draft={current} disabled={busy()} />}
      </Show>
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
      <Show when={composerMode() === "voice"}>
        <Show when={draft()} keyed>
          {(current) => (
            <Show when={!current.recording()?.voice.busy()}>
              <VoiceRecorder
                disabled={
                  busy() || Boolean(props.streaming) || !speechConnection()
                }
                onActiveChange={setRecordingActive}
                captureRecording={captureRecording}
              />
            </Show>
          )}
        </Show>
        <Show when={!speechConnection()}>
          <p class="m-0 px-2 text-xs text-muted">
            Transcription unavailable. Use Type.
          </p>
        </Show>
      </Show>
      <Show when={draft().recording()?.voice}>
        {(take) => (
          <VoiceTranscription
            take={take()}
            disabled={busy() || Boolean(props.streaming)}
            onDiscard={() => draft().setRecording(undefined)}
          />
        )}
      </Show>
      <Show when={composerMode() === "text" && pendingRecording()}>
        <p class="m-0 px-2 py-1 text-xs text-warning">
          Retry or discard the pending recording before sending.
        </p>
      </Show>
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
        <Show when={composerMode() === "text"}>
          <Textarea
            ref={input}
            name="message"
            class="chat-input"
            variant="composer"
            data-composer-input
            aria-label="Message"
            aria-describedby={hintID}
            placeholder="Send a message..."
            value={draft().text()}
            autocomplete="off"
            autofocus
            rows={1}
            disabled={props.disabled}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.isComposing &&
                // Touch-first devices need Enter for newlines; use Send instead.
                !window.matchMedia("(pointer: coarse)").matches
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
        </Show>
        <Show when={draft()} keyed>
          {(current) => (
            <PasteReferenceButton
              draft={current}
              disabled={busy()}
              compact={composerMode() === "text"}
            />
          )}
        </Show>
        <Show when={composerMode() === "voice"}>
          <div class="flex-1" />
        </Show>
        <Button
          variant="ghost"
          size="sm"
          disabled={recordingActive()}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            setComposerMode(composerMode() === "voice" ? "text" : "voice");
            if (composerMode() === "text") queueMicrotask(() => input?.focus());
          }}
        >
          <Show
            when={composerMode() === "voice"}
            fallback={
              <>
                <Mic size={18} />
                Voice
              </>
            }
          >
            <Keyboard size={18} />
            Type
          </Show>
        </Button>
        <Show when={composerMode() === "text" || props.streaming}>
          <Show
            when={props.streaming}
            fallback={
              <IconButton
                type="submit"
                variant="primary"
                aria-label="Send"
                aria-busy={draft().sending()}
                disabled={
                  busy() || recordingActive() || Boolean(pendingRecording())
                }
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
        </Show>
      </div>
    </ComposerForm>
  );
}
