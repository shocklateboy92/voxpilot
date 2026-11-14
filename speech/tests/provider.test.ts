import { expect, test } from "bun:test";
import { SpeechFault } from "../src/errors";
import { createOpenAIProvider } from "../src/provider";
import { metadata } from "./helpers";

test("provider uses the fixed endpoint/model, vocabulary array and auto-language once", async () => {
  let calls = 0;
  const provider = createOpenAIProvider(
    "synthetic-openai-key-not-a-secret",
    async (url, init) => {
      calls++;
      expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("error");
      expect(init.credentials).toBe("omit");
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer synthetic-openai-key-not-a-secret",
      );
      if (!(init.body instanceof FormData))
        throw new Error("expected multipart");
      expect([...init.body.keys()]).toEqual([
        "file",
        "model",
        "keywords[]",
        "keywords[]",
      ]);
      expect(init.body.get("model")).toBe("gpt-transcribe");
      expect(init.body.getAll("keywords[]")).toEqual(["VoxPilot", "Incus"]);
      const file = init.body.get("file");
      if (!(file instanceof File)) throw new Error("expected file");
      expect(file.name).toBe("recording.wav");
      expect(file.size).toBe(3);
      return Response.json({
        text: "Bonjour test",
        languages: [{ code: "fr" }],
      });
    },
  );
  const result = await provider(
    new Uint8Array([1, 2, 3]),
    metadata(),
    new AbortController().signal,
  );
  expect(result).toEqual({ text: "Bonjour test", languages: ["fr"] });
  expect(calls).toBe(1);
});

test("provider errors are sanitized, bounded and never retried", async () => {
  for (const response of [
    new Response("upstream secret", { status: 429 }),
    Response.json({ text: "", languages: [] }),
    Response.json({ text: "test", languages: ["incorrect schema"] }),
    new Response("x".repeat(128 * 1024 + 1)),
  ]) {
    let calls = 0;
    const provider = createOpenAIProvider("synthetic", async () => {
      calls++;
      return response;
    });
    let caught: unknown;
    try {
      await provider(
        new Uint8Array([1]),
        metadata(),
        new AbortController().signal,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof SpeechFault).toBe(true);
    if (!(caught instanceof SpeechFault))
      throw new Error("expected safe fault");
    expect(caught.code).toBe("provider_failed");
    expect(caught.providerMayHaveProcessed).toBe(true);
    expect(caught.message).not.toContain("secret");
    expect(calls).toBe(1);
  }
});
