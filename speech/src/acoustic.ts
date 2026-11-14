import createFvad from "@echogarden/fvad-wasm";
import wasmPath from "@echogarden/fvad-wasm/fvad.wasm" with { type: "file" };
import type { z } from "zod";
import {
  SPEECH_MAX_SECONDS,
  type SpeechMime,
} from "../../plugin/src/speech-contract";
import { readBounded, SpeechFault, throwIfAborted } from "./errors";

const RATE = 16000;
const FRAME = 320; // 20ms, a supported WebRTC VAD frame size.
export type AcousticResult = {
  durationSeconds: number;
  speechPresent: boolean;
};
export type AcousticGuard = (
  audio: Uint8Array<ArrayBuffer>,
  mime: z.infer<typeof SpeechMime>,
  signal: AbortSignal,
) => Promise<AcousticResult>;

export async function createAcousticGuard(
  ffmpeg = "ffmpeg",
): Promise<AcousticGuard> {
  // Both source runs and the compiled Bun executable embed this tiny WASM asset.
  const vad = await createFvad({
    wasmBinary: new Uint8Array(await Bun.file(wasmPath).arrayBuffer()),
    print: () => {},
    printErr: () => {},
  });
  if (!Bun.which(ffmpeg)) throw new SpeechFault("unavailable");
  return async (audio, mime, signal) => {
    throwIfAborted(signal);
    const format = {
      "audio/wav": "wav",
      "audio/webm": "matroska",
      "audio/mp4": "mov",
      "audio/ogg": "ogg",
    }[mime];
    let process: ReturnType<typeof Bun.spawn>;
    try {
      process = Bun.spawn(
        [
          ffmpeg,
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-max_alloc",
          "33554432",
          "-protocol_whitelist",
          "pipe",
          "-threads",
          "1",
          "-f",
          format,
          "-i",
          "pipe:0",
          "-map",
          "0:a:0",
          "-vn",
          "-sn",
          "-dn",
          "-filter_threads",
          "1",
          "-ac",
          "1",
          "-ar",
          String(RATE),
          "-f",
          "s16le",
          "pipe:1",
        ],
        {
          stdin: new Blob([audio]),
          stdout: "pipe",
          stderr: "ignore",
          // Do not forward credential paths or service configuration to codecs.
          env: { PATH: Bun.env.PATH, LANG: "C", LC_ALL: "C" },
        },
      );
    } catch {
      throw new SpeechFault("unavailable");
    }
    const kill = () => {
      process.kill("SIGKILL");
    };
    signal.addEventListener("abort", kill, { once: true });
    let pcm: Uint8Array;
    try {
      // No truncation: one sample beyond 300 seconds rejects the recording.
      if (!(process.stdout instanceof ReadableStream))
        throw new SpeechFault("invalid_audio");
      pcm = await readBounded(
        process.stdout,
        SPEECH_MAX_SECONDS * RATE * 2,
        signal,
        "invalid_audio",
      );
      if (
        (await process.exited) !== 0 ||
        pcm.length === 0 ||
        pcm.length % 2 !== 0
      ) {
        throw new SpeechFault("invalid_audio");
      }
      throwIfAborted(signal);
    } catch (error) {
      kill();
      if (error instanceof SpeechFault) throw error;
      throw new SpeechFault("invalid_audio");
    } finally {
      signal.removeEventListener("abort", kill);
      await process.exited;
    }
    const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const handle = vad._fvad_new();
    const pointer = vad._malloc(FRAME * 2);
    if (!handle || !pointer) {
      if (handle) vad._fvad_free(handle);
      if (pointer) vad._free(pointer);
      throw new SpeechFault("unavailable");
    }
    let voicedFrames = 0;
    let consecutive = 0;
    let maxConsecutive = 0;
    try {
      if (
        vad._fvad_set_mode(handle, 3) !== 0 ||
        vad._fvad_set_sample_rate(handle, RATE) !== 0
      ) {
        throw new SpeechFault("unavailable");
      }
      for (let start = 0; start < pcm.length / 2; start += FRAME) {
        throwIfAborted(signal);
        let energy = 0;
        let peak = 0;
        for (let i = 0; i < FRAME; i++) {
          const sample =
            (start + i) * 2 < pcm.length
              ? samples.getInt16((start + i) * 2, true)
              : 0;
          vad.HEAP16[pointer / 2 + i] = sample;
          energy += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
        }
        const detected = vad._fvad_process(handle, pointer, FRAME);
        if (detected < 0) throw new SpeechFault("invalid_audio");
        // VAD plus a quiet-input floor (-50dBFS RMS / -35dBFS peak).
        // Require >=200ms voiced and an >=100ms run to reject clicks/transients.
        const speech =
          detected === 1 && Math.sqrt(energy / FRAME) >= 104 && peak >= 583;
        consecutive = speech ? consecutive + 1 : 0;
        maxConsecutive = Math.max(maxConsecutive, consecutive);
        if (speech) voicedFrames++;
      }
      return {
        durationSeconds: pcm.length / 2 / RATE,
        speechPresent: voicedFrames >= 10 && maxConsecutive >= 5,
      };
    } finally {
      vad._free(pointer);
      vad._fvad_free(handle);
    }
  };
}
