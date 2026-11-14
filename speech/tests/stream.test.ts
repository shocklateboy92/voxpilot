import { expect, test } from "bun:test";
import { readBounded, SpeechFault } from "../src/errors";

test("tiny chunks use bounded storage and return exact content", async () => {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === 512) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array([index++ % 256]));
    },
  });
  const bytes = await readBounded(body, 512, new AbortController().signal);
  expect(bytes).toEqual(Uint8Array.from({ length: 512 }, (_, i) => i % 256));
});

test("pathological empty chunks cannot starve request timeout cancellation", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(0));
    },
    cancel() {
      cancelled = true;
    },
  });
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new SpeechFault("timeout")),
    10,
  );
  try {
    await expect(
      readBounded(body, 1024, controller.signal),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(cancelled).toBe(true);
  } finally {
    clearTimeout(timer);
  }
});
