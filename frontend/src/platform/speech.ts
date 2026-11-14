import {
  SPEECH_MAX_BYTES,
  SPEECH_PATHS,
  SpeechCancellation,
  SpeechCapabilities,
  SpeechFailure,
  SpeechMime,
  TranscriptionRequest,
  TranscriptionResult,
} from "@plugin/speech-contract";
import { connectionConfig } from "./connection-config";

export const speechConnection = () => connectionConfig.speech;
export const speechConfigurationError = () => connectionConfig.speechError;
export class SpeechRequestError extends Error {
  constructor(
    readonly failure: ReturnType<typeof SpeechFailure.parse>["error"],
  ) {
    super(failure.message);
  }
}
async function request(path: string, init: RequestInit) {
  const connection = speechConnection();
  if (!connection)
    throw new Error("Speech service is not configured. Use Type.");
  const response = await fetch(`${connection.url}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${connection.token}` },
    credentials: "omit",
    redirect: "error",
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const failure = SpeechFailure.safeParse(body);
    if (failure.success) throw new SpeechRequestError(failure.data.error);
    throw new Error(
      `Speech service returned HTTP ${response.status}. No automatic retry was made.`,
    );
  }
  return body;
}
export async function speechCapabilities(signal: AbortSignal) {
  const capabilities = SpeechCapabilities.parse(
    await request(SPEECH_PATHS.capabilities, { signal }),
  );
  if (!capabilities.ready)
    throw new Error(
      "OpenAI transcription is not ready. Use Type or try again later.",
    );
  return capabilities;
}
export function transcriptionMetadata(
  id: string,
  blob: Blob,
  durationSeconds: number,
  vocabulary: string[],
) {
  if (blob.size > SPEECH_MAX_BYTES)
    throw new Error("This recording exceeds the 10 MiB transcription limit.");
  return TranscriptionRequest.parse({
    id,
    provider: "openai",
    cloudAllowed: true,
    mimeType: SpeechMime.parse(blob.type.split(";")[0]),
    durationSeconds,
    vocabulary,
  });
}
export async function transcribeAudio(
  blob: Blob,
  metadata: ReturnType<typeof transcriptionMetadata>,
  signal: AbortSignal,
) {
  const body = new FormData();
  const extension = {
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
  }[metadata.mimeType];
  body.append(
    "audio",
    new Blob([blob], { type: metadata.mimeType }),
    `recording.${extension}`,
  );
  body.append("metadata", JSON.stringify(metadata));
  const result = TranscriptionResult.parse(
    await request(SPEECH_PATHS.transcriptions, {
      method: "POST",
      body,
      signal,
    }),
  );
  if (result.id !== metadata.id)
    throw new Error("Speech service returned a mismatched recording ID.");
  return result;
}
export async function cancelTranscription(id: string) {
  return SpeechCancellation.parse(
    await request(`${SPEECH_PATHS.transcriptions}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
    }),
  );
}
