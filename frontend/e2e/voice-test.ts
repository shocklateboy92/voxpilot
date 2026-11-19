import type { Page, Request } from "@playwright/test";
import { SpeechVocabulary } from "../../plugin/src/rpc";
import {
  SPEECH_MAX_BYTES,
  SPEECH_MAX_SECONDS,
  SPEECH_MAX_TERMS,
  SPEECH_MAX_VOCABULARY_CHARACTERS,
  TranscriptionRequest,
} from "../../plugin/src/speech-contract";
import { failure, SpeechFault } from "../../speech/src/errors";
import { expect, frontendTest } from "./fixtures";

export { expect };
export const test = frontendTest.extend({
  launchOptions: {
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  viewport: { width: 390, height: 844 },
});
export const token = "test-speech-token-not-real-provider-credential";
export const speechURL = "https://speech.example.invalid";

export async function mockSpeechCapabilities(page: Page) {
  await page.route(`${speechURL}/v1/capabilities`, (route) =>
    route.fulfill({
      json: {
        protocol: 1,
        provider: "openai",
        model: "gpt-transcribe",
        ready: true,
        maxBytes: SPEECH_MAX_BYTES,
        maxSeconds: SPEECH_MAX_SECONDS,
        maxTerms: SPEECH_MAX_TERMS,
        maxVocabularyCharacters: SPEECH_MAX_VOCABULARY_CHARACTERS,
        persistsAudio: false,
      },
    }),
  );
}

export function vocabulary(terms = ["VoxPilot", "Incus"]) {
  const source = { path: "fixture-vocabulary", exists: true, terms };
  return SpeechVocabulary.parse({
    terms,
    sources: { user: source, shared: source, local: source },
  });
}

export function metadata(request: Request) {
  const body = request.postDataBuffer()?.toString("utf8");
  if (!body) throw new Error("Missing multipart request");
  const part = body
    .slice(body.lastIndexOf('name="metadata"'))
    .split("\r\n\r\n")[1]
    ?.split("\r\n")[0];
  if (!part) throw new Error("Missing metadata");
  return TranscriptionRequest.parse(JSON.parse(part));
}

export function result(
  input: ReturnType<typeof metadata>,
  text = "Use pasted item 1 without changing production.",
) {
  return {
    id: input.id,
    provider: "openai",
    model: "gpt-transcribe",
    status: text ? "transcribed" : "no_speech",
    text,
    languages: ["en"],
    durationSeconds: 1,
  };
}

/** Keep mocked status, retryability and billing uncertainty aligned with the service. */
export function speechFailure(
  code: ConstructorParameters<typeof SpeechFault>[0],
  providerMayHaveProcessed = false,
) {
  const outcome = failure(new SpeechFault(code, providerMayHaveProcessed));
  return { status: outcome.status, json: outcome.body };
}

export async function mount(
  page: Page,
  options: { speech?: unknown; vocabulary?: unknown } = {},
) {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        servers: [
          {
            id: "fixture",
            name: "Fixture",
            url: "http://localhost:18001",
            password: "fixture-password",
          },
        ],
        speech: options.speech ?? { url: speechURL, token },
      },
    }),
  );
  for (const endpoint of ["provider", "model"])
    await page.route(`**/api/${endpoint}`, (route) =>
      route.fulfill({ json: { data: [] } }),
    );
  await page.route("**/api/model/default", (route) =>
    route.fulfill({ json: {} }),
  );
  await mockSpeechCapabilities(page);
  await page.route("**/api/rpc/voxpilot/vocabulary**", (route) => {
    expect(["/fixture/original-project", "/fixture/other-project"]).toContain(
      new URL(route.request().url()).searchParams.get("location[directory]"),
    );
    expect(route.request().headers().authorization).toContain("Basic ");
    return route.fulfill({
      json: { output: options.vocabulary ?? vocabulary() },
    });
  });
  // Unexpected speech calls fail closed; tests explicitly mock their own outcomes.
  await page.route(`${speechURL}/v1/transcriptions**`, (route) =>
    route.abort("connectionreset"),
  );
  await page.route("**/voice-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<main></main><output aria-label="Sent message" data-accept="true"></output>',
    }),
  );
  await page.goto("/voice-fixture");
  await page.evaluate(async () => {
    localStorage.removeItem("voxpilot-composer-mode");
    localStorage.setItem("voxpilot:serverId", "fixture");
    window.addEventListener("unhandledrejection", (event) => {
      event.preventDefault();
      const output = document.querySelector("output");
      output?.setAttribute("data-error", "true");
      output?.setAttribute(
        "data-error-message",
        event.reason instanceof Error
          ? event.reason.message
          : "Unknown rejection",
      );
    });
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "/src/styles/app.css";
    document.head.append(style);
    const url = "/e2e/voice-composer-fixture.ts";
    const { mount }: typeof import("./voice-composer-fixture") = await import(
      url
    );
    mount();
  });
}

export async function record(
  page: Page,
  during?: () => Promise<void>,
  duplicateFinish = false,
) {
  await page
    .getByRole("button", { name: "Record a message", exact: true })
    .click();
  const finish = page.getByRole("button", {
    name: "Finish recording",
    exact: true,
  });
  await expect(finish).toBeEnabled();
  await expect
    .poll(() => page.getByRole("timer").textContent())
    .not.toBe("0:00");
  await during?.();
  if (duplicateFinish)
    await finish.evaluate((element) => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  else await finish.click();
}

export async function paste(page: Page, text: string) {
  await page.evaluate(
    (value) =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { readText: () => Promise.resolve(value) },
      }),
    text,
  );
  await page.getByRole("button", { name: "Paste", exact: true }).click();
}

export async function trackMicrophone(page: Page, pending = false) {
  await page.evaluate((wait) => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await acquire(constraints);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          document
            .querySelector("output")
            ?.setAttribute("data-track", track.readyState);
        };
      }
      document
        .querySelector("output")
        ?.setAttribute("data-permission", "waiting");
      if (wait)
        await new Promise<void>((resolve) =>
          document.addEventListener("release-permission", () => resolve(), {
            once: true,
          }),
        );
      return stream;
    };
  }, pending);
}

export function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
