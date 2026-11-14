/** Browser-safe contract for the standalone speech service (not an OpenCode API). */
import { z } from "zod";

export const SPEECH_PROTOCOL = 1;
export const SPEECH_MAX_BYTES = 10 * 1024 * 1024;
export const SPEECH_MAX_SECONDS = 300;
export const SPEECH_MAX_TERMS = 30;
export const SPEECH_MAX_VOCABULARY_CHARACTERS = 2000;
export const SPEECH_PATHS = {
  capabilities: "/v1/capabilities",
  transcriptions: "/v1/transcriptions",
} as const;

export const VocabularyTerm = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((term) => !/[<>\p{Cc}]/u.test(term), {
    message:
      "Vocabulary terms must be single-line text without control characters or angle brackets.",
  })
  .transform((term) => term.normalize("NFC"));

export const SpeechConnection = z
  .object({
    url: z.string().min(1),
    token: z.string().min(32).max(256),
  })
  .strict();

export const SpeechMime = z.enum([
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
]);

// Multipart fields: `audio` (binary file) and `metadata` (this JSON object).
// No project paths, conversations, clipboard text or sample references belong here.
export const TranscriptionRequest = z
  .object({
    id: z.uuid(),
    provider: z.literal("openai"),
    cloudAllowed: z.literal(true),
    mimeType: SpeechMime,
    durationSeconds: z.number().positive().max(SPEECH_MAX_SECONDS),
    vocabulary: z
      .array(VocabularyTerm)
      .max(SPEECH_MAX_TERMS)
      .refine(
        (terms) =>
          terms.reduce((total, term) => total + term.length, 0) <=
          SPEECH_MAX_VOCABULARY_CHARACTERS,
        {
          message:
            "Vocabulary exceeds the transcription context budget. Choose fewer terms; nothing is silently dropped.",
        },
      ),
  })
  .strict();

export const SpeechCapabilities = z
  .object({
    protocol: z.literal(SPEECH_PROTOCOL),
    provider: z.literal("openai"),
    model: z.literal("gpt-transcribe"),
    ready: z.boolean(),
    maxBytes: z.literal(SPEECH_MAX_BYTES),
    maxSeconds: z.literal(SPEECH_MAX_SECONDS),
    maxTerms: z.literal(SPEECH_MAX_TERMS),
    maxVocabularyCharacters: z.literal(SPEECH_MAX_VOCABULARY_CHARACTERS),
    persistsAudio: z.literal(false),
  })
  .strict();

export const TranscriptionResult = z
  .object({
    id: z.uuid(),
    provider: z.literal("openai"),
    model: z.literal("gpt-transcribe"),
    status: z.enum(["transcribed", "no_speech"]),
    text: z.string().max(32000),
    languages: z.array(z.string().max(32)).max(16),
    durationSeconds: z.number().nonnegative().max(SPEECH_MAX_SECONDS),
  })
  .strict()
  .refine((result) =>
    result.status === "no_speech"
      ? result.text === ""
      : Boolean(result.text.trim()),
  );

export const SpeechErrorCode = z.enum([
  "unauthorized",
  "forbidden_origin",
  "invalid_request",
  "audio_too_large",
  "invalid_audio",
  "vocabulary_budget",
  "unavailable",
  "busy",
  "rate_limited",
  "id_conflict",
  "cancelled",
  "provider_failed",
  "timeout",
  "internal_error",
]);
export const SpeechFailure = z
  .object({
    error: z
      .object({
        code: SpeechErrorCode,
        message: z.string().max(500),
        retryable: z.boolean(),
        providerMayHaveProcessed: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const SpeechCancellation = z
  .object({ id: z.uuid(), cancelled: z.literal(true) })
  .strict();
