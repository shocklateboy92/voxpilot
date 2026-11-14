import { beforeAll, expect, test } from "bun:test";
import { type AcousticGuard, createAcousticGuard } from "../src/acoustic";
import { SpeechFault } from "../src/errors";
import { metadata, recording, service, wav } from "./helpers";

let guard: AcousticGuard;
beforeAll(async () => {
  guard = await createAcousticGuard();
});
const signal = () => new AbortController().signal;

test("actual ffmpeg + WebRTC VAD reject digital silence, quiet noise and a click", async () => {
  let state = 123456;
  const noise = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state % 81) - 40;
  };
  for (const bytes of [
    wav(1),
    wav(1, noise),
    wav(1, (i) => (i === 4000 ? 32000 : 0)),
  ]) {
    const result = await guard(bytes, "audio/wav", signal());
    expect(result.durationSeconds).toBe(1);
    expect(result.speechPresent).toBe(false);
  }
});

test("actual decoder rejects malformed data and decoded durations beyond 300 seconds", async () => {
  for (const bytes of [new Uint8Array([1, 2, 3]), wav(300.01)]) {
    let fault: unknown;
    try {
      await guard(bytes, "audio/wav", signal());
    } catch (error) {
      fault = error;
    }
    expect(fault instanceof SpeechFault).toBe(true);
    if (!(fault instanceof SpeechFault)) throw new Error("expected fault");
    expect(fault.code).toBe("invalid_audio");
  }
  expect((await guard(wav(300), "audio/wav", signal())).durationSeconds).toBe(
    300,
  );
});

test("synthetic speech is detected and supported recorder formats decode", async () => {
  // Speech synthesized locally, not a user's voice or a checked-in audio fixture.
  const synth = Bun.spawn(
    [
      "espeak-ng",
      "--stdout",
      "This is a synthetic speech recording for VoxPilot testing.",
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const speech = new Uint8Array(await new Response(synth.stdout).arrayBuffer());
  expect(await synth.exited).toBe(0);
  expect((await guard(speech, "audio/wav", signal())).speechPresent).toBe(true);
  for (const format of [
    { mime: "audio/webm", args: ["-c:a", "libopus", "-f", "webm"] },
    { mime: "audio/ogg", args: ["-c:a", "libopus", "-f", "ogg"] },
    {
      mime: "audio/mp4",
      args: [
        "-c:a",
        "aac",
        "-movflags",
        "frag_keyframe+empty_moov",
        "-f",
        "mp4",
      ],
    },
  ]) {
    const encoded = Bun.spawn(
      [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        ...format.args,
        "pipe:1",
      ],
      {
        stdin: new Blob([speech]),
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    const bytes = new Uint8Array(
      await new Response(encoded.stdout).arrayBuffer(),
    );
    expect(await encoded.exited).toBe(0);
    if (
      format.mime !== "audio/webm" &&
      format.mime !== "audio/ogg" &&
      format.mime !== "audio/mp4"
    )
      throw new Error("unexpected format");
    expect((await guard(bytes, format.mime, signal())).speechPresent).toBe(
      true,
    );
  }
});

test("real acoustic guard routes silence to no_speech without provider", async () => {
  let calls = 0;
  const app = service({
    guard,
    provider: async () => {
      calls++;
      throw new Error("must not run");
    },
  });
  const response = await app.fetch(recording({ audio: wav(0.5) }));
  expect(response.status).toBe(200);
  expect(calls).toBe(0);
});

test("declared MIME must match decoded media, regardless of filename/header", async () => {
  let calls = 0;
  const app = service({
    guard,
    provider: async () => {
      calls++;
      throw new Error("must not run");
    },
  });
  const response = await app.fetch(
    recording({
      audio: wav(1),
      input: { ...metadata(), mimeType: "audio/webm" },
    }),
  );
  expect(response.status).toBe(422);
  expect(calls).toBe(0);
});

test("decoder cancellation returns safely before provider", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    guard(wav(1), "audio/wav", controller.signal),
  ).rejects.toMatchObject({ code: "cancelled" });
});
