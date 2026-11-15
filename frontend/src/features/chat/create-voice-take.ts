import {
  SPEECH_MAX_TERMS,
  SPEECH_MAX_VOCABULARY_CHARACTERS,
  VocabularyTerm,
} from "@plugin/speech-contract";
import { createSignal, untrack } from "solid-js";
import type { PromptDraft } from "../../platform/prompt-files";
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
import type { fetchVocabulary } from "../../platform/vocabulary";
import type { ComposerDraft } from "./create-composer-draft";

export function vocabularyFits(terms: readonly string[]) {
  return (
    terms.length <= SPEECH_MAX_TERMS &&
    terms.reduce((total, term) => total + term.length, 0) <=
      SPEECH_MAX_VOCABULARY_CHARACTERS
  );
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
  },
) {
  let snapshot = draft.snapshot();
  let snapshotCaptured = false;
  const backend = speechBackendGeneration();
  const [phase, setPhase] = createSignal<
    | "idle"
    | "preparing"
    | "subset"
    | "transcribing"
    | "ready"
    | "no_speech"
    | "failed"
    | "cancelled"
    | "sending"
  >("idle");
  const [terms, setTerms] = createSignal<string[]>([]);
  const [selectedTerms, setSelectedTerms] = createSignal<string[]>([]);
  const [message, setMessage] = createSignal("");
  let audio: { blob: Blob; duration: number } | undefined;
  let metadata: ReturnType<typeof transcriptionMetadata> | undefined;
  let metadataCreated = 0;
  let abort: AbortController | undefined;
  let id = crypto.randomUUID();
  let transcript = "";
  let transcriptApplied = false;
  let run = 0;
  const owned = () => backend === speechBackendGeneration() && capture.owned();
  const busy = () => ["preparing", "transcribing", "sending"].includes(phase());

  function attach(value: { blob: Blob; duration: number }) {
    audio = value;
  }
  function applyTranscript() {
    if (transcriptApplied || !transcript) return;
    draft.setText([draft.text(), transcript].filter(Boolean).join("\n\n"));
    transcriptApplied = true;
  }
  async function sendTranscript() {
    if (!transcript || busy()) return;
    if (!owned()) {
      applyTranscript();
      setMessage(
        "The session or project changed. Return to the original conversation to send.",
      );
      return;
    }
    setPhase("sending");
    draft.setSending(true);
    try {
      const submitted = transcriptApplied ? draft.snapshot() : snapshot;
      const text = transcriptApplied
        ? submitted.text
        : [submitted.text, transcript].filter(Boolean).join("\n\n");
      const accepted = await capture.send({
        text: [
          text,
          ...submitted.references.map(
            (entry) => `Pasted item ${entry.number}:\n${entry.text}`,
          ),
        ]
          .filter(Boolean)
          .join("\n\n"),
        files: submitted.attachments.map((entry) => entry.file),
      });
      if (accepted) {
        draft.consume(submitted);
        if (draft.recording()?.voice === take) draft.setRecording(undefined);
      } else applyTranscript();
    } catch (error) {
      applyTranscript();
      throw error;
    } finally {
      draft.setSending(false);
      setPhase("ready");
    }
  }
  function cancel() {
    if (!abort || phase() === "sending") return;
    abort.abort();
    const cancelledRun = ++run;
    if (metadata) {
      // Cancellation failures are state, never a hidden retry or a toast catch.
      void cancelTranscription(metadata.id).catch(() => {
        if (run !== cancelledRun) return;
        setMessage("Cancellation could not be confirmed.");
      });
    }
    setPhase("cancelled");
    setMessage("Transcription cancelled.");
  }
  async function transcribe(subset = false) {
    if (busy() || !audio) return;
    if (backend !== speechBackendGeneration()) {
      setMessage("Backend changed. Start a new recording or use Type.");
      return;
    }
    if (metadata && Date.now() - metadataCreated >= 15 * 60_000) {
      setMessage("Retry expired. Start a new paid attempt.");
      return;
    }
    if (!snapshotCaptured) {
      snapshot = draft.snapshot();
      snapshotCaptured = true;
    }
    const currentAudio = audio;
    const controller = new AbortController();
    const currentRun = ++run;
    abort = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(360_000),
    ]);
    const unregister = registerSpeechJob(() =>
      untrack(() => {
        if (run === currentRun) cancel();
      }),
    );
    setPhase("preparing");
    setMessage("");
    let uploaded = false;
    try {
      if (!metadata) {
        await speechCapabilities(signal);
        if (signal.aborted || run !== currentRun) return;
        if (!subset) {
          const vocabulary = await capture.vocabulary(signal);
          if (signal.aborted || run !== currentRun) return;
          const canonical = (vocabulary?.terms ?? []).map((term) =>
            VocabularyTerm.parse(term),
          );
          setTerms(canonical);
          if (!vocabularyFits(canonical)) {
            setSelectedTerms([]);
            setPhase("subset");
            setMessage("Choose up to 30 terms or 2000 characters.");
            return;
          }
          setSelectedTerms(canonical);
        }
        metadata = transcriptionMetadata(
          id,
          currentAudio.blob,
          currentAudio.duration,
          selectedTerms(),
        );
        metadataCreated = Date.now();
      }
      if (
        signal.aborted ||
        run !== currentRun ||
        backend !== speechBackendGeneration()
      )
        return;
      setPhase("transcribing");
      uploaded = true;
      const result = await transcribeAudio(currentAudio.blob, metadata, signal);
      if (
        signal.aborted ||
        run !== currentRun ||
        backend !== speechBackendGeneration()
      )
        return;
      if (result.status === "no_speech") {
        setPhase("no_speech");
        setMessage("No speech detected.");
        return;
      }
      transcript = result.text;
      setPhase("ready");
      if (!owned()) {
        applyTranscript();
        setMessage(
          "The session or project changed. Return to the original conversation to send.",
        );
        return;
      }
    } catch (error) {
      if (controller.signal.aborted || run !== currentRun) return;
      setPhase("failed");
      setMessage(
        error instanceof SpeechRequestError
          ? error.message
          : uploaded
            ? "Transcription could not be confirmed."
            : "Could not prepare transcription. Check the service and vocabulary.",
      );
      // Sanitized local error only; validation/provider payloads must not leak.
      throw new Error(message());
    } finally {
      unregister();
      if (abort === controller) abort = undefined;
      if (
        run === currentRun &&
        (phase() === "preparing" || phase() === "transcribing")
      )
        setPhase("cancelled");
    }
    // Native prompt errors remain native errors; never retry paid transcription
    // merely because admission of an already-transcribed prompt failed.
    if (run === currentRun && phase() === "ready") await sendTranscript();
  }
  async function newAttempt() {
    if (busy()) return;
    id = crypto.randomUUID();
    metadata = undefined;
    snapshotCaptured = false;
    transcript = "";
    transcriptApplied = false;
    setPhase("idle");
    await transcribe();
  }
  const take = {
    phase,
    busy,
    terms,
    selectedTerms,
    setSelectedTerms,
    message,
    attach,
    transcribe,
    cancel,
    sendTranscript,
    canSend: owned,
    newAttempt,
    continueSubset: () => transcribe(true),
  };
  return take;
}
export type VoiceTake = ReturnType<typeof createVoiceTake>;
