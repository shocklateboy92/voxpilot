import { expect, test } from "bun:test";
import {
  SpeechFailure,
  TranscriptionResult,
} from "../../plugin/src/speech-contract";
import { MAX_REQUEST_BYTES } from "../src/service";
import { cancel, deferred, recording, service } from "./helpers";

test("real Bun HTTP multipart service works without a provider network request", async () => {
  const app = service();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: app.fetch,
    maxRequestBodySize: MAX_REQUEST_BYTES,
  });
  try {
    const template = recording();
    const result = await fetch(new URL("/v1/transcriptions", server.url), {
      method: "POST",
      headers: template.headers,
      body: template.body,
    });
    expect(TranscriptionResult.parse(await result.json()).status).toBe(
      "transcribed",
    );
  } finally {
    app.close();
    await server.stop(true);
  }
});

test("explicit cancellation over real HTTP stops a provider and caches uncertainty", async () => {
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
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: app.fetch,
    maxRequestBodySize: MAX_REQUEST_BYTES,
  });
  try {
    const id = crypto.randomUUID();
    const template = recording({ id });
    const work = fetch(new URL("/v1/transcriptions", server.url), {
      method: "POST",
      headers: template.headers,
      body: template.body,
    });
    await started.promise;
    const deletion = cancel(id);
    const cancelled = await fetch(
      new URL(`/v1/transcriptions/${id}`, server.url),
      { method: "DELETE", headers: deletion.headers },
    );
    expect(cancelled.status).toBe(200);
    const result = SpeechFailure.parse(await (await work).json());
    expect(result.error.code).toBe("cancelled");
    expect(result.error.providerMayHaveProcessed).toBe(true);
    expect(aborted).toBe(true);
  } finally {
    app.close();
    await server.stop(true);
  }
});

test("real Bun client disconnect signals abort after upload", async () => {
  const started = deferred<void>();
  const aborted = deferred<void>();
  const app = service({
    provider: async (_audio, _metadata, signal) => {
      started.resolve();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted.resolve();
            reject(signal.reason);
          },
          { once: true },
        ),
      );
    },
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: app.fetch,
    maxRequestBodySize: MAX_REQUEST_BYTES,
  });
  try {
    const controller = new AbortController();
    const template = recording();
    const work = fetch(new URL("/v1/transcriptions", server.url), {
      method: "POST",
      headers: template.headers,
      body: template.body,
      signal: controller.signal,
    }).catch(() => undefined);
    await started.promise;
    controller.abort();
    await work;
    await Promise.race([
      aborted.promise,
      Bun.sleep(1000).then(() => {
        throw new Error("Bun did not signal disconnect");
      }),
    ]);
  } finally {
    app.close();
    await server.stop(true);
  }
});
