import type { z } from "zod";
import {
  type SpeechErrorCode,
  SpeechFailure,
} from "../../plugin/src/speech-contract";

type Code = z.infer<typeof SpeechErrorCode>;
const messages: Record<Code, string> = {
  unauthorized: "Speech authorization is required.",
  forbidden_origin: "This origin is not allowed.",
  invalid_request: "The speech request is invalid.",
  audio_too_large: "The recording exceeds the audio size limit.",
  invalid_audio: "The recording cannot be decoded or exceeds 300 seconds.",
  vocabulary_budget:
    "Shorten or fix the vocabulary files, then refresh; nothing is silently dropped.",
  unavailable: "The speech service is not ready.",
  busy: "The speech service is at capacity.",
  rate_limited: "The speech request rate limit was reached.",
  id_conflict: "This recording ID was already used for different content.",
  cancelled: "The recording was cancelled.",
  provider_failed:
    "Transcription failed. Use a new recording ID for an explicit retry.",
  timeout:
    "Transcription timed out. Use a new recording ID for an explicit retry.",
  internal_error: "The speech request could not be completed.",
};
const statuses: Record<Code, number> = {
  unauthorized: 401,
  forbidden_origin: 403,
  invalid_request: 400,
  audio_too_large: 413,
  invalid_audio: 422,
  vocabulary_budget: 400,
  unavailable: 503,
  busy: 429,
  rate_limited: 429,
  id_conflict: 409,
  cancelled: 409,
  provider_failed: 502,
  timeout: 504,
  internal_error: 500,
};

// Only this fixed vocabulary crosses the wire. Never expose exception/upstream text.
export class SpeechFault extends Error {
  constructor(
    readonly code: Code,
    readonly providerMayHaveProcessed = false,
  ) {
    super(messages[code]);
  }
}

export function failure(fault: SpeechFault) {
  return {
    status: statuses[fault.code],
    body: SpeechFailure.parse({
      error: {
        code: fault.code,
        message: messages[fault.code],
        retryable: ["busy", "rate_limited", "unavailable"].includes(fault.code),
        providerMayHaveProcessed: fault.providerMayHaveProcessed,
      },
    }),
  };
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason instanceof SpeechFault
      ? signal.reason
      : new SpeechFault("cancelled");
  }
}

export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
  overflow: Code = "audio_too_large",
) {
  if (!body) throw new SpeechFault("invalid_request");
  const reader = body.getReader();
  // One fixed buffer avoids attacker-controlled per-chunk object overhead
  // (millions of one-byte chunks must not become millions of retained arrays).
  const bytes = new Uint8Array(limit);
  let size = 0;
  let chunks = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    throwIfAborted(signal);
    while (true) {
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) break;
      if (value.byteLength > limit - size) throw new SpeechFault(overflow);
      bytes.set(value, size);
      size += value.byteLength;
      // Also let timeout/disconnect callbacks run for pathological tiny/empty
      // chunk streams instead of starving the event loop with resolved reads.
      if (++chunks % 128 === 0) await Bun.sleep(0);
    }
    return bytes.slice(0, size);
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
