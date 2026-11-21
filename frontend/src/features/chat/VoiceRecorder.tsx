import { SPEECH_MAX_SECONDS } from "@plugin/speech-contract";
import ArrowUp from "lucide-solid/icons/arrow-up";
import Mic from "lucide-solid/icons/mic";
import Square from "lucide-solid/icons/square";
import X from "lucide-solid/icons/x";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { registerSpeechJob } from "../../platform/speech-lifecycle";
import { requestScreenWakeLock } from "../../platform/wake-lock";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import type { DraftRecording } from "./create-composer-draft";

const MAX_DURATION = SPEECH_MAX_SECONDS;
const BAR_COUNT = 25;

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function VoiceRecorder(props: {
  compact?: boolean;
  disabled: boolean;
  onActiveChange: (active: boolean) => void;
  onStartPointerDown?: () => void;
  captureRecording: () => (audio: RecordedAudio) => void;
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
  let unregisterMicrophone: (() => void) | undefined;
  let releaseWakeLock: (() => void) | undefined;

  function release() {
    releaseWakeLock?.();
    releaseWakeLock = undefined;
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
    unregisterMicrophone?.();
    unregisterMicrophone = undefined;
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
    const complete = props.captureRecording();
    unregisterMicrophone = registerSpeechJob(cancel);
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
        if (blob.size) {
          complete({
            blob,
            duration: Math.min(
              MAX_DURATION,
              (performance.now() - startedAt) / 1000,
            ),
          });
        }
        release();
        recorder = undefined;
        setState("idle");
        props.onActiveChange(false);
        unregisterMicrophone?.();
        unregisterMicrophone = undefined;
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
      for (const track of acquired.getAudioTracks())
        track.onended = () => finish();
      active.start(1000);
      setSeconds(0);
      setState("recording");
      releaseWakeLock = requestScreenWakeLock();
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
    if (document.hidden && state() !== "stopping") cancel();
  };
  document.addEventListener("visibilitychange", hide);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", hide);
    cancel();
  });

  return (
    <Show
      when={!props.compact}
      fallback={
        <div class="flex items-center gap-2">
          <Show when={state() !== "idle"}>
            <IconButton
              size="lg"
              variant="floating"
              aria-label="Cancel recording"
              disabled={state() === "stopping"}
              onPointerDown={(event) => event.preventDefault()}
              onClick={cancel}
            >
              <X size={20} />
            </IconButton>
            <span
              role="status"
              aria-label="Recording status"
              class="rounded-lg bg-surface px-2 py-1 font-mono text-xs text-text"
            >
              {state() === "recording"
                ? clock(seconds())
                : state() === "requesting"
                  ? "Microphone…"
                  : "Preparing…"}
            </span>
          </Show>
          <IconButton
            size="lg"
            class="shadow-floating"
            variant={state() === "idle" ? "primary" : "stop"}
            aria-label={
              state() === "idle" ? "Record a message" : "Finish recording"
            }
            title={
              !supported
                ? "Recording unavailable. Expand controls to type."
                : undefined
            }
            disabled={
              state() === "idle"
                ? props.disabled || !supported
                : state() !== "recording"
            }
            onPointerDown={(event) => {
              if (state() === "idle") props.onStartPointerDown?.();
              event.preventDefault();
            }}
            onClick={() => (state() === "idle" ? void start() : finish())}
          >
            <Show when={state() === "idle"} fallback={<Square size={18} />}>
              <Mic size={20} />
            </Show>
          </IconButton>
        </div>
      }
    >
      <div class="flex min-w-0 flex-col gap-2 px-2 py-2">
        <Show
          when={state() !== "idle"}
          fallback={
            <Button
              variant="primary"
              disabled={props.disabled || !supported}
              onPointerDown={(event) => {
                props.onStartPointerDown?.();
                event.preventDefault();
              }}
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
              disabled={state() === "stopping"}
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
              <For
                each={Array.from({ length: BAR_COUNT }, (_, index) => index)}
              >
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
              title="Finish recording"
              disabled={state() !== "recording"}
              onPointerDown={(event) => event.preventDefault()}
              onClick={finish}
            >
              <ArrowUp size={18} />
            </IconButton>
          </div>
        </Show>
        <Show when={state() !== "idle" || !supported}>
          <p
            class="m-0 text-center text-xs text-muted"
            role="status"
            aria-label="Recording status"
          >
            {state() === "requesting"
              ? "Waiting for microphone permission…"
              : state() === "recording"
                ? "Recording · 5 minute limit"
                : state() === "stopping"
                  ? "Preparing audio…"
                  : "Recording unavailable. Use Type."}
          </p>
        </Show>
      </div>
    </Show>
  );
}

export type RecordedAudio = Pick<DraftRecording, "blob" | "duration">;
