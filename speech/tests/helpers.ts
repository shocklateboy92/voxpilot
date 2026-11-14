import { TranscriptionRequest } from "../../plugin/src/speech-contract";
import { createSpeechService, type ServiceOptions } from "../src/service";

export const TOKEN = "synthetic-speech-test-token-000000000000";
export const ORIGIN = "https://voxpilot.example.test";
export const BASE = "http://speech.example.test";
export function metadata(id: string = crypto.randomUUID()) {
  return TranscriptionRequest.parse({
    id,
    provider: "openai",
    cloudAllowed: true,
    mimeType: "audio/wav",
    durationSeconds: 1,
    vocabulary: ["VoxPilot", "Incus"],
  });
}
export function recording(
  options: {
    id?: string;
    audio?: Uint8Array<ArrayBuffer>;
    input?: unknown;
    signal?: AbortSignal;
    origin?: string;
    token?: string;
  } = {},
) {
  const form = new FormData();
  form.set("metadata", JSON.stringify(options.input ?? metadata(options.id)));
  form.set(
    "audio",
    new Blob([options.audio ?? new Uint8Array([1, 2, 3])], {
      type: "audio/wav",
    }),
    "untrusted-name.wav",
  );
  return new Request(`${BASE}/v1/transcriptions`, {
    method: "POST",
    body: form,
    signal: options.signal,
    headers: {
      Origin: options.origin ?? ORIGIN,
      Authorization: `Bearer ${options.token ?? TOKEN}`,
    },
  });
}
export function cancel(id: string) {
  return new Request(`${BASE}/v1/transcriptions/${id}`, {
    method: "DELETE",
    headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}` },
  });
}
export function service(options: Partial<ServiceOptions> = {}) {
  return createSpeechService({
    token: TOKEN,
    origins: [ORIGIN],
    guard: async () => ({ durationSeconds: 1.25, speechPresent: true }),
    provider: async () => ({
      text: "Synthetic test transcript.",
      languages: ["en"],
    }),
    ...options,
  });
}
export function deferred<T>() {
  return Promise.withResolvers<T>();
}
export function wav(
  seconds: number,
  sample: (index: number) => number = () => 0,
) {
  const length = Math.round(seconds * 16000);
  const bytes = new Uint8Array(44 + length * 2);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, sample(i), true);
  return bytes;
}
