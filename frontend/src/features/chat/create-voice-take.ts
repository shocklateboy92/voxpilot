import { createSignal, untrack } from "solid-js";
import type { PromptDraft, ViewerContext } from "../../platform/prompt-files";
import {
  cancelTranscription,
  SpeechRequestError,
  speechCapabilities,
  transcribeAudio,
  transcriptionMetadata,
} from "../../platform/speech";
import {
  registerSpeechJob,
  speechBackendGeneration,
} from "../../platform/speech-lifecycle";
import {
  type fetchVocabulary,
  vocabularyBudgetError,
} from "../../platform/vocabulary";
import {
  type ComposerDraft,
  composerPrompt,
  type DraftRecording,
} from "./create-composer-draft";

type DraftSnapshot = ReturnType<ComposerDraft["snapshot"]>;
type RecordedAudio = Pick<DraftRecording, "blob" | "duration">;
type Attempt = {
  id: string;
  audio: RecordedAudio;
  snapshot: DraftSnapshot;
} & (
  | { kind: "unprepared" }
  | {
      kind: "prepared";
      metadata: ReturnType<typeof transcriptionMetadata>;
      created: number;
    }
);
type PreparedAttempt = Extract<Attempt, { kind: "prepared" }>;
type SendSource =
  | { kind: "captured"; snapshot: DraftSnapshot; transcript: string }
  | { kind: "draft" };
type Recovery =
  | { kind: "retry" | "fix" }
  | { kind: "recover" | "new"; providerMayHaveProcessed: boolean };
type VoiceState = { message: string } & (
  | { phase: "idle" }
  | { phase: "preparing"; attempt: Attempt; controller: AbortController }
  | {
      phase: "transcribing";
      attempt: PreparedAttempt;
      controller: AbortController;
    }
  | { phase: "failed" | "cancelled"; attempt: Attempt; recovery: Recovery }
  | { phase: "ready" | "sending"; source: SendSource }
  | { phase: "no_speech"; attempt: PreparedAttempt }
);

function recoveryFor(
  error: unknown,
  uploaded: boolean,
  previous?: Recovery,
): Recovery {
  if (error instanceof SpeechRequestError) {
    const { code, retryable, providerMayHaveProcessed } = error.failure;
    // A refusal of this retry says nothing about an earlier uncertain upload.
    if (retryable)
      return previous?.kind === "recover" ? previous : { kind: "retry" };
    if (
      [
        "provider_failed",
        "timeout",
        "cancelled",
        "internal_error",
        "id_conflict",
      ].includes(code)
    )
      return { kind: "new", providerMayHaveProcessed };
    return { kind: "fix" };
  }
  return uploaded
    ? { kind: "recover", providerMayHaveProcessed: true }
    : { kind: "retry" };
}

/** Capture draft/destination before microphone awaits; freeze prompt before cloud work. */
export function createVoiceTake(
  draft: ComposerDraft,
  capture: {
    owned: () => boolean;
    vocabulary: (
      signal: AbortSignal,
    ) => Promise<Awaited<ReturnType<typeof fetchVocabulary>> | undefined>;
    send: (content: PromptDraft) => Promise<boolean>;
    viewer?: ViewerContext;
  },
) {
  const backend = speechBackendGeneration();
  const [state, setState] = createSignal<VoiceState>({
    phase: "idle",
    message: "",
  });
  let audio: RecordedAudio | undefined;
  let run = 0;
  const phase = () => state().phase;
  const message = () => state().message;
  const setMessage = (message: string) =>
    setState((current) => ({ ...current, message }));
  const owned = () => backend === speechBackendGeneration() && capture.owned();
  const recovery = () => {
    const current = state();
    return current.phase === "failed" || current.phase === "cancelled"
      ? current.recovery
      : undefined;
  };
  const busy = () => {
    const current = state();
    return (
      current.phase === "preparing" ||
      current.phase === "transcribing" ||
      current.phase === "sending"
    );
  };

  function attach(value: RecordedAudio) {
    audio = value;
  }
  function applyTranscript(source: SendSource): SendSource {
    if (source.kind === "draft") return source;
    draft.setText(
      [draft.text(), source.transcript].filter(Boolean).join("\n\n"),
    );
    return { kind: "draft" };
  }
  async function sendTranscript() {
    const current = state();
    if (current.phase !== "ready") return;
    let source = current.source;
    if (!owned()) {
      setState({
        phase: "ready",
        source: applyTranscript(source),
        message:
          "The session or project changed. Return to the original conversation to send.",
      });
      return;
    }
    setState({ ...current, phase: "sending" });
    draft.setSending(true);
    try {
      const original =
        source.kind === "draft" ? draft.snapshot() : source.snapshot;
      // Removing a selection must also remove it from an already transcribed take.
      const submitted = {
        ...original,
        selection:
          original.selection === draft.selection()
            ? original.selection
            : undefined,
      };
      const text =
        source.kind === "draft"
          ? submitted.text
          : [submitted.text, source.transcript].filter(Boolean).join("\n\n");
      const accepted = await capture.send(
        composerPrompt(submitted, text, capture.viewer),
      );
      if (accepted) {
        draft.consume(submitted);
        if (draft.recording()?.voice === take) draft.setRecording(undefined);
      } else source = applyTranscript(source);
    } catch (error) {
      source = applyTranscript(source);
      throw error;
    } finally {
      draft.setSending(false);
      setState({ phase: "ready", source, message: message() });
    }
  }
  function cancel() {
    const current = state();
    if (current.phase !== "preparing" && current.phase !== "transcribing")
      return;
    current.controller.abort();
    const cancelledRun = ++run;
    setState({
      phase: "cancelled",
      attempt: current.attempt,
      recovery:
        current.attempt.kind === "prepared"
          ? { kind: "new", providerMayHaveProcessed: true }
          : { kind: "retry" },
      message: "Transcription cancelled.",
    });
    if (current.attempt.kind === "prepared") {
      // Cancellation failures are state, never a hidden retry or a toast catch.
      void cancelTranscription(current.attempt.metadata.id).catch(() => {
        if (run !== cancelledRun) return;
        setState({
          phase: "cancelled",
          attempt: current.attempt,
          recovery: { kind: "recover", providerMayHaveProcessed: true },
          message: "Cancellation could not be confirmed.",
        });
      });
    }
  }
  async function transcribe() {
    if (busy() || !audio) return;
    const current = state();
    // A completed transcript is sent/corrected, never transcribed again.
    if (current.phase === "ready" || current.phase === "no_speech") return;
    if (
      (current.phase === "failed" || current.phase === "cancelled") &&
      current.recovery.kind !== "retry" &&
      current.recovery.kind !== "recover"
    )
      return;
    if (backend !== speechBackendGeneration()) {
      setMessage("Backend changed. Start a new recording or use Type.");
      return;
    }
    let attempt: Attempt =
      "attempt" in current
        ? current.attempt
        : {
            kind: "unprepared",
            id: crypto.randomUUID(),
            audio,
            snapshot: draft.snapshot(),
          };
    if (
      attempt.kind === "prepared" &&
      Date.now() - attempt.created >= 15 * 60_000
    ) {
      const previous = recovery();
      setState({
        phase: "failed",
        attempt,
        recovery: {
          kind: "new",
          providerMayHaveProcessed:
            previous?.kind === "recover" || previous?.kind === "new"
              ? previous.providerMayHaveProcessed
              : false,
        },
        message: "Retry expired. Start a new paid attempt.",
      });
      return;
    }
    const controller = new AbortController();
    const currentRun = ++run;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(360_000),
    ]);
    const unregister = registerSpeechJob(() =>
      untrack(() => {
        if (run === currentRun) cancel();
      }),
    );
    setState({ phase: "preparing", attempt, controller, message: "" });
    try {
      if (attempt.kind === "unprepared") {
        await speechCapabilities(signal);
        if (signal.aborted || run !== currentRun) return;
        const vocabulary = await capture.vocabulary(signal);
        if (signal.aborted || run !== currentRun) return;
        const terms = vocabulary?.terms ?? [];
        const error = vocabularyBudgetError(terms);
        if (error) {
          setState({
            phase: "failed",
            attempt,
            recovery: { kind: "retry" },
            message: error,
          });
          return;
        }
        attempt = {
          ...attempt,
          kind: "prepared",
          metadata: transcriptionMetadata(
            attempt.id,
            attempt.audio.blob,
            attempt.audio.duration,
            terms,
          ),
          created: Date.now(),
        };
      }
      if (
        signal.aborted ||
        run !== currentRun ||
        backend !== speechBackendGeneration()
      )
        return;
      setState({ phase: "transcribing", attempt, controller, message: "" });
      const result = await transcribeAudio(
        attempt.audio.blob,
        attempt.metadata,
        signal,
      );
      if (
        signal.aborted ||
        run !== currentRun ||
        backend !== speechBackendGeneration()
      )
        return;
      if (result.status === "no_speech") {
        setState({
          phase: "no_speech",
          attempt,
          message: "No speech detected.",
        });
        return;
      }
      const source: SendSource = {
        kind: "captured",
        snapshot: attempt.snapshot,
        transcript: result.text,
      };
      if (!owned()) {
        setState({
          phase: "ready",
          source: applyTranscript(source),
          message:
            "The session or project changed. Return to the original conversation to send.",
        });
        return;
      }
      setState({ phase: "ready", source, message: "" });
    } catch (error) {
      if (controller.signal.aborted || run !== currentRun) return;
      const message =
        error instanceof SpeechRequestError
          ? error.message
          : state().phase === "transcribing"
            ? "Transcription could not be confirmed."
            : "Could not prepare transcription. Check the service and vocabulary.";
      setState({
        phase: "failed",
        attempt,
        recovery: recoveryFor(
          error,
          state().phase === "transcribing",
          "recovery" in current ? current.recovery : undefined,
        ),
        message,
      });
      // Sanitized local error only; validation/provider payloads must not leak.
      throw new Error(message);
    } finally {
      unregister();
      const current = state();
      if (
        run === currentRun &&
        (current.phase === "preparing" || current.phase === "transcribing")
      )
        setState({
          phase: "cancelled",
          attempt: current.attempt,
          recovery:
            current.attempt.kind === "prepared"
              ? { kind: "recover", providerMayHaveProcessed: true }
              : { kind: "retry" },
          message: current.message,
        });
    }
    // Native prompt errors remain native errors; never retry paid transcription
    // merely because admission of an already-transcribed prompt failed.
    if (run === currentRun && phase() === "ready") await sendTranscript();
  }
  async function newAttempt() {
    if (busy()) return;
    const current = recovery();
    if (current?.kind !== "new" && current?.kind !== "recover") return;
    setState({ phase: "idle", message: "" });
    await transcribe();
  }
  const take = {
    phase,
    busy,
    recovery,
    message,
    attach,
    transcribe,
    cancel,
    sendTranscript,
    canSend: owned,
    newAttempt,
  };
  return take;
}
export type VoiceTake = ReturnType<typeof createVoiceTake>;
