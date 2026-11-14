import { describe, expect, test } from "bun:test";
import {
  SPEECH_MAX_BYTES,
  SPEECH_MAX_SECONDS,
  SpeechConnection,
  TranscriptionRequest,
  TranscriptionResult,
} from "../src/speech-contract";

const request = {
  id: "5ccb6aa8-6478-48f1-8db9-0d3baf0f43af",
  provider: "openai",
  cloudAllowed: true,
  mimeType: "audio/webm",
  durationSeconds: 12,
  vocabulary: ["VoxPilot", "OpenCode"],
};

describe("standalone speech contract", () => {
  test("requires explicit permission for this request", () => {
    expect(TranscriptionRequest.safeParse(request).success).toBe(true);
    expect(
      TranscriptionRequest.safeParse({ ...request, cloudAllowed: false })
        .success,
    ).toBe(false);
    const { cloudAllowed: _permission, ...withoutPermission } = request;
    expect(TranscriptionRequest.safeParse(withoutPermission).success).toBe(
      false,
    );
  });

  test("rejects sample references, clipboard contents and unknown provider options", () => {
    for (const extra of [
      { reference: "private reference" },
      { prompt: "clipboard" },
      { model: "other" },
      { apiKey: "not-a-key" },
    ]) {
      expect(
        TranscriptionRequest.safeParse({ ...request, ...extra }).success,
      ).toBe(false);
    }
  });

  test("shares canonical term normalization with project vocabulary", () => {
    expect(
      TranscriptionRequest.parse({ ...request, vocabulary: ["  Cafe\u0301  "] })
        .vocabulary,
    ).toEqual(["Café"]);
    for (const term of ["<instruction>", "two\nlines", "control\u0000"])
      expect(
        TranscriptionRequest.safeParse({ ...request, vocabulary: [term] })
          .success,
      ).toBe(false);
  });

  test("fails over-budget context instead of dropping terms", () => {
    expect(
      TranscriptionRequest.safeParse({
        ...request,
        vocabulary: Array.from({ length: 31 }, (_, index) => `term${index}`),
      }).success,
    ).toBe(false);
    expect(
      TranscriptionRequest.safeParse({
        ...request,
        vocabulary: Array.from({ length: 20 }, () => "x".repeat(101)),
      }).success,
    ).toBe(false);
  });

  test("bounds recording duration and MIME types", () => {
    expect(SPEECH_MAX_BYTES).toBe(10 * 1024 * 1024);
    for (const durationSeconds of [0, -1, SPEECH_MAX_SECONDS + 0.01])
      expect(
        TranscriptionRequest.safeParse({ ...request, durationSeconds }).success,
      ).toBe(false);
    expect(
      TranscriptionRequest.safeParse({
        ...request,
        mimeType: "application/octet-stream",
      }).success,
    ).toBe(false);
  });

  test("no-speech cannot carry invented transcript text", () => {
    const result = {
      id: request.id,
      provider: "openai",
      model: "gpt-transcribe",
      status: "no_speech",
      text: "",
      languages: [],
      durationSeconds: 3,
    };
    expect(TranscriptionResult.safeParse(result).success).toBe(true);
    expect(
      TranscriptionResult.safeParse({ ...result, text: "Thank you." }).success,
    ).toBe(false);
    expect(
      TranscriptionResult.safeParse({ ...result, status: "transcribed" })
        .success,
    ).toBe(false);
  });

  test("speech authentication config cannot contain provider credentials", () => {
    const connection = {
      url: "https://speech.staging.lasath.com",
      token: "x".repeat(64),
    };
    expect(SpeechConnection.safeParse(connection).success).toBe(true);
    expect(
      SpeechConnection.safeParse({ ...connection, openaiKey: "not-a-key" })
        .success,
    ).toBe(false);
    expect(
      SpeechConnection.safeParse({ ...connection, token: "short" }).success,
    ).toBe(false);
  });
});
