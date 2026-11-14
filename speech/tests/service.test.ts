import { expect, test } from "bun:test";
import {
  SpeechCapabilities,
  SpeechFailure,
  TranscriptionResult,
} from "../../plugin/src/speech-contract";
import { SpeechFault } from "../src/errors";
import { MAX_REQUEST_BYTES } from "../src/service";
import {
  BASE,
  cancel,
  deferred,
  metadata,
  ORIGIN,
  recording,
  service,
  TOKEN,
} from "./helpers";

async function error(response: Response) {
  return SpeechFailure.parse(await response.json()).error;
}

test("auth and exact origin are checked before reading bodies", async () => {
  const app = service();
  let reads = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        reads++;
        throw new Error("must not read");
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(`${BASE}/v1/transcriptions`, {
    method: "POST",
    body,
    headers: {
      Authorization: "Bearer wrong",
      "Content-Type": "multipart/form-data; boundary=test",
    },
  });
  expect((await error(await app.fetch(request))).code).toBe("unauthorized");
  expect(reads).toBe(0);
  const forbidden = await app.fetch(
    recording({ origin: `${ORIGIN}.evil.test` }),
  );
  expect((await error(forbidden)).code).toBe("forbidden_origin");
  expect(forbidden.headers.has("Access-Control-Allow-Origin")).toBe(false);
  expect(
    (await error(await app.fetch(recording({ origin: "null" })))).code,
  ).toBe("forbidden_origin");
});

test("capabilities and limited unauthenticated CORS preflight", async () => {
  const app = service();
  const capabilities = await app.fetch(
    new Request(`${BASE}/v1/capabilities`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN },
    }),
  );
  expect(SpeechCapabilities.parse(await capabilities.json()).ready).toBe(true);
  expect(capabilities.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  expect(capabilities.headers.has("Access-Control-Allow-Credentials")).toBe(
    false,
  );
  const preflight = await app.fetch(
    new Request(`${BASE}/v1/transcriptions`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    }),
  );
  expect(preflight.status).toBe(204);
  const invalid = await app.fetch(
    new Request(`${BASE}/v1/transcriptions`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "cookie",
      },
    }),
  );
  expect(invalid.status).toBe(400);
  const health = await app.fetch(new Request(`${BASE}/healthz`));
  expect(await health.text()).toBe("ok");
});

test("bounded request streams reject a missing/lying length header", async () => {
  let providerCalls = 0;
  const app = service({
    provider: async () => {
      providerCalls++;
      return { text: "unused", languages: [] };
    },
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES + 1));
      controller.close();
    },
  });
  const result = await app.fetch(
    new Request(`${BASE}/v1/transcriptions`, {
      method: "POST",
      body,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "multipart/form-data; boundary=test",
        "Content-Length": "1",
      },
    }),
  );
  expect((await error(result)).code).toBe("audio_too_large");
  expect(providerCalls).toBe(0);
});

test("cloud permission, vocabulary budget, field set and MIME are enforced", async () => {
  const app = service();
  expect(
    (
      await error(
        await app.fetch(
          recording({ input: { ...metadata(), cloudAllowed: false } }),
        ),
      )
    ).code,
  ).toBe("invalid_request");
  expect(
    (
      await error(
        await app.fetch(
          recording({ input: { ...metadata(), vocabulary: ["a\nb"] } }),
        ),
      )
    ).code,
  ).toBe("vocabulary_budget");
  expect(
    (
      await error(
        await app.fetch(
          recording({
            input: {
              ...metadata(),
              vocabulary: Array.from({ length: 31 }, () => "term"),
            },
          }),
        ),
      )
    ).code,
  ).toBe("vocabulary_budget");
  expect(
    (
      await error(
        await app.fetch(
          recording({
            input: {
              ...metadata(),
              vocabulary: Array.from({ length: 20 }, () => "a".repeat(110)),
            },
          }),
        ),
      )
    ).code,
  ).toBe("vocabulary_budget");
  expect(
    (
      await error(
        await app.fetch(
          recording({ input: { ...metadata(), project: "/private" } }),
        ),
      )
    ).code,
  ).toBe("invalid_request");
  const form = new FormData();
  form.set("metadata", JSON.stringify(metadata()));
  form.append("metadata", JSON.stringify(metadata()));
  form.set("audio", new Blob(["test"], { type: "audio/wav" }), "file.wav");
  const extra = await app.fetch(
    new Request(`${BASE}/v1/transcriptions`, {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
  );
  expect((await error(extra)).code).toBe("invalid_request");
});

test("decoded no-speech and overduration never call provider", async () => {
  let calls = 0;
  const provider = async () => {
    calls++;
    return { text: "unused", languages: [] };
  };
  const quiet = service({
    provider,
    guard: async () => ({ durationSeconds: 2, speechPresent: false }),
  });
  const result = TranscriptionResult.parse(
    await (await quiet.fetch(recording())).json(),
  );
  expect(result.status).toBe("no_speech");
  expect(result.text).toBe("");
  expect(result.durationSeconds).toBe(2);
  const long = service({
    provider,
    guard: async () => ({ durationSeconds: 300.01, speechPresent: true }),
  });
  expect((await error(await long.fetch(recording()))).code).toBe(
    "invalid_audio",
  );
  expect(calls).toBe(0);
});

test("multipart recorder MIME formats tolerate Bun's extension canonicalization", async () => {
  const app = service();
  for (const [mime, extension] of [
    ["audio/webm", "webm"],
    ["audio/mp4", "mp4"],
    ["audio/ogg", "ogg"],
    ["audio/wav", "wav"],
  ]) {
    const form = new FormData();
    form.set("metadata", JSON.stringify({ ...metadata(), mimeType: mime }));
    form.set(
      "audio",
      new Blob(["synthetic"], { type: mime }),
      `recording.${extension}`,
    );
    const request = new Request(`${BASE}/v1/transcriptions`, {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect((await app.fetch(request)).status).toBe(200);
  }
});

test("browser MediaRecorder codec parameters and extensionless uploads are accepted", async () => {
  const app = service();
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({ ...metadata(), mimeType: "audio/webm" }),
  );
  form.set(
    "audio",
    new Blob(["synthetic"], { type: "audio/webm;codecs=opus" }),
    "recording",
  );
  const response = await app.fetch(
    new Request(`${BASE}/v1/transcriptions`, {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
  );
  expect(response.status).toBe(200);
});

test("completed success and failed IDs replay; changed content conflicts", async () => {
  let calls = 0;
  const app = service({
    provider: async () => {
      calls++;
      return { text: "test", languages: ["en", "fr"] };
    },
  });
  const id = crypto.randomUUID();
  const first = await (await app.fetch(recording({ id }))).json();
  expect(await (await app.fetch(recording({ id }))).json()).toEqual(first);
  expect(
    (
      await error(
        await app.fetch(recording({ id, audio: new Uint8Array([4]) })),
      )
    ).code,
  ).toBe("id_conflict");
  expect(calls).toBe(1);
  const failed = service({
    provider: async () => {
      calls++;
      throw new Error("upstream secret body");
    },
  });
  const failedId = crypto.randomUUID();
  const failure = await error(await failed.fetch(recording({ id: failedId })));
  expect(failure.code).toBe("internal_error");
  expect(failure.providerMayHaveProcessed).toBe(true);
  expect(JSON.stringify(failure)).not.toContain("upstream secret");
  expect(await error(await failed.fetch(recording({ id: failedId })))).toEqual(
    failure,
  );
  expect(calls).toBe(2);
});

test("pending duplicate shares one job even with both job slots occupied", async () => {
  const finish = deferred<{ text: string; languages: string[] }>();
  const started = deferred<void>();
  let calls = 0;
  const app = service({
    provider: async () => {
      calls++;
      if (calls === 2) started.resolve();
      return finish.promise;
    },
  });
  const id = crypto.randomUUID();
  const first = app.fetch(recording({ id }));
  const second = app.fetch(recording());
  await started.promise;
  const duplicate = app.fetch(recording({ id }));
  await Bun.sleep(10);
  expect(calls).toBe(2);
  const busy = await app.fetch(recording());
  expect((await error(busy)).code).toBe("busy");
  finish.resolve({ text: "test", languages: [] });
  const results = await Promise.all([first, second, duplicate]);
  expect(results.every((result) => result.status === 200)).toBe(true);
});

test("cancel tombstone before upload and cancellation during guard prevent paid calls", async () => {
  const started = deferred<void>();
  let calls = 0;
  const app = service({
    provider: async () => {
      calls++;
      return { text: "unused", languages: [] };
    },
    guard: async (_audio, _mime, signal) => {
      started.resolve();
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
      throw new Error("unreachable");
    },
  });
  const before = crypto.randomUUID();
  expect((await app.fetch(cancel(before))).status).toBe(200);
  expect((await error(await app.fetch(recording({ id: before })))).code).toBe(
    "cancelled",
  );
  const during = crypto.randomUUID();
  const work = app.fetch(recording({ id: during }));
  await started.promise;
  await app.fetch(cancel(during));
  const result = await error(await work);
  expect(result.code).toBe("cancelled");
  expect(result.providerMayHaveProcessed).toBe(false);
  expect(calls).toBe(0);
});

test("disconnect and explicit cancellation abort provider; failed outcome stays cached", async () => {
  for (const explicit of [true, false]) {
    const started = deferred<void>();
    let aborted = false;
    const app = service({
      provider: async (_audio, _metadata, signal) => {
        started.resolve();
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      },
    });
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const work = app.fetch(recording({ id, signal: controller.signal }));
    await started.promise;
    if (explicit) await app.fetch(cancel(id));
    else controller.abort();
    const result = await error(await work);
    expect(result.code).toBe("cancelled");
    expect(result.providerMayHaveProcessed).toBe(true);
    expect(aborted).toBe(true);
    expect(await error(await app.fetch(recording({ id })))).toEqual(result);
  }
});

test("timeouts are bounded and cached with provider uncertainty", async () => {
  let calls = 0;
  const app = service({
    timeoutMs: 25,
    provider: async (_audio, _metadata, signal) => {
      calls++;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  });
  const id = crypto.randomUUID();
  const result = await error(await app.fetch(recording({ id })));
  expect(result.code).toBe("timeout");
  expect(result.providerMayHaveProcessed).toBe(true);
  expect(await error(await app.fetch(recording({ id })))).toEqual(result);
  expect(calls).toBe(1);
});

test("15-minute cache is bounded without early eviction, pending work never expires", async () => {
  let now = 0;
  let calls = 0;
  const app = service({
    cacheSize: 1,
    now: () => now,
    provider: async () => {
      calls++;
      return { text: "test", languages: [] };
    },
  });
  const id = crypto.randomUUID();
  expect((await app.fetch(recording({ id }))).status).toBe(200);
  expect((await error(await app.fetch(recording()))).code).toBe("busy");
  now = 15 * 60 * 1000 - 1;
  expect((await app.fetch(recording({ id }))).status).toBe(200);
  expect(calls).toBe(1);
  now++;
  expect((await app.fetch(recording({ id }))).status).toBe(200);
  expect(calls).toBe(2);
  const started = deferred<void>();
  const finish = deferred<{ text: string; languages: string[] }>();
  const pending = service({
    cacheSize: 1,
    now: () => now,
    provider: async () => {
      started.resolve();
      return finish.promise;
    },
  });
  const work = pending.fetch(recording());
  await started.promise;
  now += 16 * 60 * 1000;
  expect((await error(await pending.fetch(recording()))).code).toBe("busy");
  finish.resolve({ text: "test", languages: [] });
  await work;
});

test("rate limiting and readiness fail without provider calls", async () => {
  const app = service({ now: () => 0 });
  for (let i = 0; i < 6; i++)
    expect((await app.fetch(recording())).status).toBe(200);
  expect((await error(await app.fetch(recording()))).code).toBe("rate_limited");
  const notReady = service({
    ready: false,
    provider: async () => {
      throw new Error("must not run");
    },
  });
  expect((await error(await notReady.fetch(recording()))).code).toBe(
    "unavailable",
  );
  const unknown = service({
    guard: async () => {
      throw new SpeechFault("invalid_audio");
    },
  });
  const id = crypto.randomUUID();
  expect((await error(await unknown.fetch(recording({ id })))).code).toBe(
    "invalid_audio",
  );
  expect((await error(await unknown.fetch(recording({ id })))).code).toBe(
    "invalid_audio",
  );
});
