import { z } from "zod";
import type {
  TranscriptionRequest,
  TranscriptionResult,
} from "../../plugin/src/speech-contract";
import { readBounded, SpeechFault, throwIfAborted } from "./errors";

const ProviderResponse = z.object({
  text: z.string().max(32000),
  languages: z.array(z.object({ code: z.string().min(1).max(32) })).max(16),
});
type Metadata = z.infer<typeof TranscriptionRequest>;
type ProviderOutput = Pick<
  z.infer<typeof TranscriptionResult>,
  "text" | "languages"
>;
export type Provider = (
  audio: Uint8Array<ArrayBuffer>,
  metadata: Metadata,
  signal: AbortSignal,
) => Promise<ProviderOutput>;
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function createOpenAIProvider(
  key: string,
  fetcher: Fetch = fetch,
): Provider {
  return async (audio, metadata, signal) => {
    throwIfAborted(signal);
    const form = new FormData();
    const extension = {
      "audio/wav": "wav",
      "audio/webm": "webm",
      "audio/mp4": "mp4",
      "audio/ogg": "ogg",
    }[metadata.mimeType];
    form.set(
      "file",
      new Blob([audio], { type: metadata.mimeType }),
      `recording.${extension}`,
    );
    form.set("model", "gpt-transcribe");
    for (const term of metadata.vocabulary) form.append("keywords[]", term);
    // No prompt, language hints, cleanup pass, cookies, redirects, or retries.
    try {
      const response = await fetcher(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal,
          redirect: "error",
          credentials: "omit",
        },
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new SpeechFault("provider_failed", true);
      }
      const bytes = await readBounded(
        response.body,
        128 * 1024,
        signal,
        "provider_failed",
      );
      const value = ProviderResponse.safeParse(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (!value.success || !value.data.text.trim())
        throw new SpeechFault("provider_failed", true);
      return {
        text: value.data.text,
        languages: value.data.languages.map((language) => language.code),
      };
    } catch {
      if (signal.aborted) {
        const code =
          signal.reason instanceof SpeechFault
            ? signal.reason.code
            : "cancelled";
        throw new SpeechFault(code, true);
      }
      throw new SpeechFault("provider_failed", true);
    }
  };
}
