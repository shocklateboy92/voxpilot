import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Keyboard from "lucide-solid/icons/keyboard";
import LoaderCircle from "lucide-solid/icons/loader-circle";
import Mic from "lucide-solid/icons/mic";
import Paperclip from "lucide-solid/icons/paperclip";
import Square from "lucide-solid/icons/square";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import type { PromptDraft, ViewerContext } from "../../platform/prompt-files";
import { speechConnection } from "../../platform/speech";
import {
  type fetchVocabulary,
  vocabularyBudgetError,
} from "../../platform/vocabulary";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Textarea } from "../../ui/Textarea";
import { AttachmentStrip } from "./attachments/AttachmentStrip";
import { clipboardFiles } from "./attachments/attachment-input";
import { ATTACHMENT_ACCEPT } from "./attachments/attachment-policy";
import { ComposerForm } from "./ComposerForm";
import { composerDraft, composerPrompt } from "./create-composer-draft";
import { createVoiceTake } from "./create-voice-take";
import { defaultModelData, modelData } from "./model-utils";
import { PastedReferences, PasteReferenceButton } from "./PastedReferences";
import { composerMode, selectedModel, setComposerMode } from "./preferences";
import type { ReadingControls } from "./reading-controls";
import { SelectionReference } from "./SelectionReference";
import { type RecordedAudio, VoiceRecorder } from "./VoiceRecorder";
import { VoiceTranscription } from "./VoiceTranscription";

export function MessageComposer(props: {
  readingControls?: ReadingControls;
  sessionID?: string;
  disabled?: boolean;
  streaming?: boolean;
  onSend: (
    content: PromptDraft,
    sessionID: string | undefined,
  ) => Promise<boolean>;
  onStop?: () => void;
  viewerContext?: ViewerContext;
  onSelectionPointerDown?: () => void;
  onCaptureSelection?: () => void;
  voiceDirectory?: string;
  readVoiceVocabulary?: (
    directory: string,
    signal: AbortSignal,
  ) => ReturnType<typeof fetchVocabulary>;
}) {
  const compact = () => props.readingControls?.reading ?? false;
  let input: HTMLTextAreaElement | undefined;
  let picker: HTMLInputElement | undefined;
  const hintID = createUniqueId();
  const draft = createMemo(() => composerDraft(props.sessionID));
  const [recordingActive, setRecordingActive] = createSignal(false);
  const hideIdleRecorder = () =>
    compact() && Boolean(props.streaming) && !recordingActive();
  const [
    vocabularyError,
    { refetch: refreshVocabulary, mutate: setVocabularyError },
  ] = createResource(
    () => {
      const directory = props.voiceDirectory;
      return directory
        ? { directory, read: props.readVoiceVocabulary }
        : undefined;
    },
    async ({ directory, read }) => {
      if (!read) return;
      try {
        return vocabularyBudgetError(
          (await read(directory, AbortSignal.timeout(10_000))).terms,
        );
      } catch {
        // Expected configuration errors stay visible, rather than becoming toasts.
        return "Could not load speech vocabulary. Check the vocabulary files and connection, then refresh. Type is still available.";
      }
    },
  );
  let mounted = true;
  onCleanup(() => {
    mounted = false;
  });
  function captureRecording() {
    props.onCaptureSelection?.();
    const current = draft();
    current.setRecording(undefined);
    const sessionID = props.sessionID;
    const directory = props.voiceDirectory;
    const read = props.readVoiceVocabulary;
    const send = props.onSend;
    const controls = props.readingControls;
    const take = createVoiceTake(current, {
      owned: () =>
        mounted &&
        props.sessionID === sessionID &&
        (directory === undefined || props.voiceDirectory === directory),
      vocabulary: async (signal) => {
        // Capture the reader/directory before permission awaits; do not read a
        // newly selected project's vocabulary for this recording.
        if (!directory || !read) return undefined;
        const vocabulary = await read(directory, signal);
        if (mounted && props.voiceDirectory === directory)
          setVocabularyError(vocabularyBudgetError(vocabulary.terms));
        return vocabulary;
      },
      viewer: props.viewerContext,
      send: (content) => send(content, sessionID),
    });
    return (audio: RecordedAudio) => {
      const recording = current.setRecording({ ...audio, voice: take });
      if (!recording) return;
      take.attach(recording);
      if (mounted && untrack(() => props.sessionID) === sessionID)
        controls?.expand();
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
    if (compact()) return;
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
    const content = composerPrompt(
      submitted,
      submitted.text,
      props.viewerContext,
    );
    current.setSending(true);
    try {
      const accepted = await send(content, sessionID);
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
    <ComposerForm
      compact={compact()}
      data-composer-mode={composerMode()}
      onSubmit={(event) => void submit(event)}
    >
      <SelectionReference draft={draft()} disabled={busy()} />
      <Show
        when={
          compact() &&
          !props.streaming &&
          (!speechConnection() || vocabularyError())
        }
      >
        <p
          role="status"
          class="absolute right-0 bottom-full m-0 mb-1 rounded-lg bg-surface px-2 py-1 text-right text-xs whitespace-nowrap text-muted"
        >
          Voice unavailable
        </p>
      </Show>
      <div classList={{ hidden: compact(), contents: !compact() }}>
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
          <Show when={vocabularyError()}>
            {(error) => (
              <div class="px-1 py-1">
                <p
                  role="status"
                  aria-label="Vocabulary status"
                  class="text-error"
                >
                  {error()}
                </p>
                <Button
                  size="sm"
                  disabled={vocabularyError.loading}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => void refreshVocabulary()}
                >
                  Refresh vocabulary
                </Button>
              </div>
            )}
          </Show>
        </div>
      </div>
      {/* Hide idle compact controls during generation without disposing capture. */}
      <div
        classList={{
          hidden: hideIdleRecorder(),
          contents: !hideIdleRecorder(),
        }}
      >
        <Show when={composerMode() === "voice" || compact()}>
          <Show when={draft()} keyed>
            {(current) => (
              <Show when={!current.recording()?.voice.busy()}>
                <VoiceRecorder
                  compact={compact()}
                  disabled={
                    busy() ||
                    Boolean(props.streaming) ||
                    !speechConnection() ||
                    !props.voiceDirectory ||
                    vocabularyError.loading ||
                    Boolean(vocabularyError())
                  }
                  onActiveChange={(active) => {
                    setRecordingActive(active);
                    if (active && compact()) setComposerMode("voice");
                  }}
                  captureRecording={captureRecording}
                  onStartPointerDown={props.onSelectionPointerDown}
                />
              </Show>
            )}
          </Show>
          <Show when={!compact() && vocabularyError.loading}>
            <p
              role="status"
              aria-label="Vocabulary status"
              class="m-0 px-2 text-xs text-muted"
            >
              Checking speech vocabulary…
            </p>
          </Show>
          <Show when={!compact() && !speechConnection()}>
            <p class="m-0 px-2 text-xs text-muted">
              Transcription unavailable. Use Type.
            </p>
          </Show>
        </Show>
      </div>
      <div classList={{ hidden: compact(), contents: !compact() }}>
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
              autofocus={!compact()}
              rows={1}
              disabled={props.disabled}
              onPointerDown={() => props.onSelectionPointerDown?.()}
              onFocus={() => props.onCaptureSelection?.()}
              onClick={() => props.onCaptureSelection?.()}
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
          <Show when={props.readingControls}>
            <Button
              variant="ghost"
              size={composerMode() === "text" ? "icon" : "sm"}
              aria-label="Return to reading"
              aria-expanded={true}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => props.readingControls?.collapse()}
            >
              <ChevronDown size={18} />
              <Show when={composerMode() === "voice"}>Hide</Show>
            </Button>
          </Show>
          <Button
            variant="ghost"
            size="sm"
            disabled={recordingActive()}
            onPointerDown={(event) => {
              props.onSelectionPointerDown?.();
              event.preventDefault();
            }}
            onClick={() => {
              if (composerMode() === "voice") props.onCaptureSelection?.();
              setComposerMode(composerMode() === "voice" ? "text" : "voice");
              if (composerMode() === "text")
                queueMicrotask(() => input?.focus());
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
                  <Show
                    when={draft().sending()}
                    fallback={<ArrowUp size={18} />}
                  >
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
      </div>
      <Show when={compact() && props.streaming}>
        <IconButton
          size="lg"
          class="self-end shadow-floating"
          variant="stop"
          aria-label="Stop generating"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => props.onStop?.()}
        >
          <Square size={18} />
        </IconButton>
      </Show>
    </ComposerForm>
  );
}
