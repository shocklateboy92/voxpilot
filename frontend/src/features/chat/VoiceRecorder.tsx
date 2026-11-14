import ArrowUp from "lucide-solid/icons/arrow-up";
import Download from "lucide-solid/icons/download";
import Mic from "lucide-solid/icons/mic";
import X from "lucide-solid/icons/x";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import type { ComposerDraft } from "./create-composer-draft";

const MAX_DURATION = 5 * 60;
const BAR_COUNT = 25;

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function VoiceRecorder(props: {
  draft: ComposerDraft;
  disabled: boolean;
  onActiveChange: (active: boolean) => void;
}) {
  const [state, setState] = createSignal<
    "idle" | "requesting" | "recording" | "stopping"
  >("idle");
  const [seconds, setSeconds] = createSignal(0);
  const [levels, setLevels] = createSignal(
    Array.from({ length: BAR_COUNT }, () => 0),
  );
  const supported =
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined" &&
    typeof AudioContext !== "undefined";
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let frame: number | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;

  function release() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (timer !== undefined) clearInterval(timer);
    frame = undefined;
    timer = undefined;
    for (const track of stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    stream = undefined;
    if (context) void context.close();
    context = undefined;
  }

  function cancel() {
    generation += 1;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder = undefined;
    release();
    setState("idle");
    props.onActiveChange(false);
  }

  function finish() {
    if (state() !== "recording") return;
    setState("stopping");
    recorder?.stop();
    release();
  }

  async function start() {
    if (props.disabled || state() !== "idle" || !supported) return;
    const token = ++generation;
    const target = props.draft;
    setState("requesting");
    props.onActiveChange(true);
    let started = false;
    try {
      // Create/resume during the gesture, before the permission prompt on iOS.
      context = new AudioContext();
      await context.resume();
      if (token !== generation) return;
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (token !== generation) {
        for (const track of acquired.getTracks()) track.stop();
        return;
      }
      stream = acquired;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(
        acquired,
        mimeType ? { mimeType } : undefined,
      );
      recorder = active;
      const chunks: Blob[] = [];
      const startedAt = performance.now();
      active.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      active.onstop = () => {
        if (token !== generation) return;
        const blob = new Blob(chunks, { type: active.mimeType });
        if (blob.size)
          target.setRecording({
            blob,
            duration: Math.min(
              MAX_DURATION,
              (performance.now() - startedAt) / 1000,
            ),
          });
        release();
        recorder = undefined;
        setState("idle");
        props.onActiveChange(false);
      };
      active.onerror = () => {
        if (token !== generation) return;
        cancel();
        void Promise.reject(
          new Error(
            "Audio recording failed. Please try recording again or switch to Type.",
          ),
        );
      };
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(acquired).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      function draw() {
        analyser.getByteFrequencyData(samples);
        setLevels(
          Array.from({ length: BAR_COUNT }, (_, index) => {
            const sample =
              samples[Math.floor((index * samples.length) / BAR_COUNT)] ?? 0;
            return sample / 255;
          }),
        );
        frame = requestAnimationFrame(draw);
      }
      for (const track of acquired.getAudioTracks()) track.onended = finish;
      active.start(1000);
      setSeconds(0);
      setState("recording");
      started = true;
      draw();
      timer = setInterval(() => {
        const elapsed = (performance.now() - startedAt) / 1000;
        setSeconds(elapsed);
        if (elapsed >= MAX_DURATION) finish();
      }, 200);
    } finally {
      if (!started && token === generation) cancel();
    }
  }

  const hide = () => {
    if (!document.hidden) return;
    if (state() === "requesting") cancel();
    else finish();
  };
  document.addEventListener("visibilitychange", hide);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", hide);
    cancel();
  });

  return (
    <div class="flex min-w-0 flex-col gap-2 px-2 py-2">
      <Show when={props.draft.recording()}>
        {(recording) => (
          <div class="flex min-w-0 flex-col gap-2 rounded-xl bg-surface-dark p-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-semibold text-text">
                Recording ready · {clock(recording().duration)}
              </span>
              <IconButton
                variant="ghost"
                aria-label="Discard recording"
                disabled={props.disabled || state() !== "idle"}
                onClick={() => props.draft.setRecording(undefined)}
              >
                <X size={18} />
              </IconButton>
            </div>
            {/* biome-ignore lint/a11y/useMediaCaption: This is the user's local recording preview; transcription is not connected yet. */}
            <audio
              ref={(element) => {
                onCleanup(() => {
                  element.pause();
                  element.removeAttribute("src");
                  element.load();
                });
              }}
              aria-label="Recorded audio"
              controls
              src={recording().url}
              class="h-10 w-full min-w-0"
            />
            <a
              class="inline-flex min-h-9 items-center gap-2 self-start rounded px-1 text-sm text-accent focus-visible:outline-2 focus-visible:outline-accent"
              href={recording().url}
              download={`voxpilot-recording.${recording().blob.type.includes("mp4") ? "m4a" : "webm"}`}
            >
              <Download size={14} />
              Save audio
            </a>
            <p class="m-0 text-xs text-muted">
              Local preview only. Nothing has been uploaded or sent. Save audio
              to keep it after a reload.
            </p>
          </div>
        )}
      </Show>
      <Show
        when={state() !== "idle"}
        fallback={
          <Button
            variant="primary"
            disabled={
              props.disabled || !supported || Boolean(props.draft.recording())
            }
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void start()}
          >
            <Mic size={20} />
            Record a message
          </Button>
        }
      >
        <div class="flex min-w-0 items-center gap-2">
          <IconButton
            variant="ghost"
            aria-label="Cancel recording"
            onPointerDown={(event) => event.preventDefault()}
            onClick={cancel}
          >
            <X size={18} />
          </IconButton>
          <div
            class="flex h-11 min-w-0 flex-1 items-center justify-center gap-0.5 overflow-hidden"
            role="img"
            aria-label="Microphone audio level"
          >
            <For each={Array.from({ length: BAR_COUNT }, (_, index) => index)}>
              {(index) => (
                <span
                  class="w-1 shrink-0 rounded-full bg-accent"
                  style={{ height: `${3 + (levels()[index] ?? 0) * 32}px` }}
                />
              )}
            </For>
          </div>
          <span class="font-mono text-xs text-muted" role="timer">
            {clock(seconds())}
          </span>
          <IconButton
            variant="primary"
            aria-label="Finish recording"
            title="Finish and preview recording"
            disabled={state() !== "recording"}
            onPointerDown={(event) => event.preventDefault()}
            onClick={finish}
          >
            <ArrowUp size={18} />
          </IconButton>
        </div>
      </Show>
      <p
        class="m-0 text-center text-xs text-muted"
        role="status"
        aria-label="Recording status"
      >
        {state() === "requesting"
          ? "Waiting for microphone permission…"
          : state() === "recording"
            ? "Recording · refer to pasted items by number · 5 minute limit"
            : state() === "stopping"
              ? "Preparing audio preview…"
              : !supported
                ? "Recording needs HTTPS and a supported browser. You can still use Type."
                : "Voice prototype · audio stays on this device"}
      </p>
    </div>
  );
}
