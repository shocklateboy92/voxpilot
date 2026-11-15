import type { Page, Request } from "@playwright/test";
import { SpeechVocabulary } from "../../plugin/src/rpc";
import {
  SPEECH_MAX_BYTES,
  SPEECH_MAX_SECONDS,
  SPEECH_MAX_TERMS,
  SPEECH_MAX_VOCABULARY_CHARACTERS,
  TranscriptionRequest,
} from "../../plugin/src/speech-contract";
import { expect, frontendTest as test } from "./fixtures";

test.use({
  launchOptions: {
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  viewport: { width: 390, height: 844 },
});
const token = "test-speech-token-not-real-provider-credential";
const speechURL = "https://speech.example.invalid";
function vocabulary(terms = ["VoxPilot", "Incus"]) {
  const source = { path: "private-project-list", exists: true, terms };
  return SpeechVocabulary.parse({
    terms,
    sources: { user: source, shared: source, local: source },
  });
}
function metadata(request: Request) {
  const body = request.postDataBuffer()?.toString("utf8");
  if (!body) throw new Error("Missing multipart request");
  const part = body
    .slice(body.lastIndexOf('name="metadata"'))
    .split("\r\n\r\n")[1]
    ?.split("\r\n")[0];
  if (!part) throw new Error("Missing metadata");
  const input = TranscriptionRequest.parse(JSON.parse(part));
  expect(input.cloudAllowed).toBe(true);
  return input;
}
function result(
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
async function mount(
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
  await page.route("**/api/provider", (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route("**/api/model", (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route("**/api/model/default", (route) =>
    route.fulfill({ json: {} }),
  );
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
  await page.route("**/api/rpc/voxpilot/vocabulary**", (route) => {
    expect(["/fixture/original-project", "/fixture/other-project"]).toContain(
      new URL(route.request().url()).searchParams.get("location[directory]"),
    );
    expect(route.request().headers().authorization).toContain("Basic ");
    return route.fulfill({
      json: { output: options.vocabulary ?? vocabulary() },
    });
  });
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
      document.querySelector("output")?.setAttribute("data-error", "true");
      document
        .querySelector("output")
        ?.setAttribute(
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
async function record(
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
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator("audio")).toHaveCount(0);
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
async function paste(page: Page, text: string) {
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

test("normal Finish authorizes cloud transcription automatically without collector, preview, download, consent or storage controls", async ({
  page,
}) => {
  let requests = 0;
  await mount(page);
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    requests++;
    return route.fulfill({ json: result(metadata(route.request())) });
  });
  for (let take = 1; take <= 2; take++) {
    await record(page);
    await expect(page.getByLabel("Sent message")).toHaveAttribute(
      "data-sends",
      String(take),
    );
    await expect(page.locator("audio")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Save audio", exact: true }),
    ).toHaveCount(0);
    for (const name of [
      "Upload test sample",
      "Finish preview only",
      "Close recording preview",
      "Transcribe to draft",
      "Transcribe and send",
      "Record sample",
    ]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
        0,
      );
    }
  }
  expect(requests).toBe(2);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(token);
});

test("production recording has only transient voice state and creates no audio preview object URL", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    const types: string[] = [];
    URL.createObjectURL = (value) => {
      types.push(value instanceof Blob ? value.type : "media-source");
      document
        .querySelector("output")
        ?.setAttribute("data-url-types", JSON.stringify(types));
      return create(value);
    };
    URL.revokeObjectURL = (url) => {
      document
        .querySelector("output")
        ?.setAttribute("data-url-revoked", "true");
      revoke(url);
    };
  });
  await page.getByLabel("Attach images", { exact: true }).setInputFiles({
    name: "preview-kept.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM2kAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const output = page.getByLabel("Sent message");
  await expect(output).toHaveAttribute("data-url-types", '["image/png"]');
  await page.route(`${speechURL}/v1/transcriptions`, (route) =>
    route.abort("connectionreset"),
  );
  await record(page);
  await expect(
    page.getByRole("button", { name: "Retry same transcription", exact: true }),
  ).toBeVisible();
  const recording = await page.evaluate(async () => {
    const url = "/src/features/chat/create-composer-draft.ts";
    const {
      composerDraft,
    }: typeof import("../src/features/chat/create-composer-draft") =
      await import(url);
    const current = composerDraft("first").recording();
    if (!current) throw new Error("Missing production recording");
    return {
      keys: Object.keys(current).sort(),
      bytes: current.blob.size,
      duration: current.duration,
      voiceStatus: current.voice.phase(),
    };
  });
  expect(recording.keys).toEqual(["blob", "duration", "voice"]);
  expect(recording.bytes).toBeGreaterThan(0);
  expect(recording.duration).toBeGreaterThan(0);
  expect(recording.voiceStatus).toBe("failed");
  await expect(output).toHaveAttribute("data-url-types", '["image/png"]');
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Save audio", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Discard recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove preview-kept.png", exact: true }),
  ).toBeVisible();
  await expect(output).not.toHaveAttribute("data-url-revoked", "true");
  await page
    .getByRole("button", { name: "Remove preview-kept.png", exact: true })
    .click();
  await expect(output).toHaveAttribute("data-url-revoked", "true");
});

test("Finish directly transcribes and sends original typed text, numbered references and images once, never collecting samples", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Original typed context.");
  await page.getByLabel("Attach images", { exact: true }).setInputFiles({
    name: "example.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM2kAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await paste(page, "PRIVATE PASTED CONTENT");
  let calls = 0;
  let samples = 0;
  page.on("request", (request) => {
    if (request.url().includes("saveSpeechSample")) samples++;
  });
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    calls++;
    const input = metadata(route.request());
    expect(input.cloudAllowed).toBe(true);
    expect(input.vocabulary).toEqual(["VoxPilot", "Incus"]);
    expect(JSON.stringify(input)).not.toContain("PRIVATE");
    expect(JSON.stringify(input)).not.toContain("Original");
    expect(JSON.stringify(input)).not.toContain("private-project-list");
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(route.request().headers().cookie).toBeUndefined();
    return route.fulfill({ json: result(input) });
  });
  await record(page, () => paste(page, "REFERENCE ADDED WHILE RECORDING"));
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Original typed context.\n\nUse pasted item 1 without changing production.\n\nPasted item 1:\nPRIVATE PASTED CONTENT\n\nPasted item 2:\nREFERENCE ADDED WHILE RECORDING",
  );
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-session",
    "first",
  );
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-files",
    "example.png",
  );
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-sends",
    "1",
  );
  await expect(page.getByLabel("Recorded audio")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview item 1", exact: true }),
  ).toHaveCount(0);
  expect(calls).toBe(1);
  expect(samples).toBe(0);
});

test("rejected prompt supports corrections and Type send without retranscription, retaining transcript and references", async ({
  page,
}) => {
  await mount(page);
  await page
    .getByLabel("Sent message")
    .evaluate((element) => element.setAttribute("data-accept", "false"));
  await paste(page, "Retained reference");
  let calls = 0;
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    calls++;
    return route.fulfill({
      json: result(metadata(route.request()), "Incorrect production target"),
    });
  });
  await record(page);
  await expect(
    page.getByRole("button", { name: "Send transcript", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Local preview only. Nothing has been uploaded or sent. Save audio to keep it after a reload.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Correct staging target");
  await page
    .getByLabel("Sent message")
    .evaluate((element) => element.setAttribute("data-accept", "false"));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Correct staging target");
  await expect(
    page.getByRole("button", { name: "Preview item 1", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Sent message")
    .evaluate((element) => element.setAttribute("data-accept", "true"));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Correct staging target\n\nPasted item 1:\nRetained reference",
  );
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeEmpty();
  expect(calls).toBe(1);
});

test("no speech produces no prompt, retains the draft and offers a fresh recording without a preview", async ({
  page,
}) => {
  await mount(page);
  await paste(page, "Keep this");
  await page.route(`${speechURL}/v1/transcriptions`, (route) =>
    route.fulfill({ json: result(metadata(route.request()), "") }),
  );
  await record(page);
  await expect(
    page.getByRole("status", { name: "Transcription status", exact: true }),
  ).toContainText("No speech detected");
  await expect(page.getByLabel("Sent message")).toBeEmpty();
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Preview item 1", exact: true }),
  ).toBeVisible();
});

test("prompt admission failure preserves the transcript and retries sending without another cloud request", async ({
  page,
}) => {
  await mount(page);
  await page
    .getByLabel("Sent message")
    .evaluate((element) => element.setAttribute("data-throw-send", "true"));
  await paste(page, "Keep prompt reference");
  let requests = 0;
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    requests++;
    return route.fulfill({
      json: result(metadata(route.request()), "Keep transcript"),
    });
  });
  await record(page);
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-error-message",
    "Prompt admission failed",
  );
  await expect(
    page.getByRole("button", { name: "Send transcript", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("audio")).toHaveCount(0);
  await page
    .getByLabel("Sent message")
    .evaluate((element) => element.removeAttribute("data-throw-send"));
  await page
    .getByRole("button", { name: "Send transcript", exact: true })
    .click();
  await expect(page.getByLabel("Recorded audio")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview item 1", exact: true }),
  ).toHaveCount(0);
  expect(requests).toBe(1);
});

test("preparation retry retains its captured draft even before request metadata exists", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Captured context");
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  let preparations = 0;
  await page.route(`${speechURL}/v1/capabilities`, (route) =>
    ++preparations === 1 ? route.abort("connectionreset") : route.fallback(),
  );
  await record(page);
  const retry = page.getByRole("button", {
    name: "Retry same transcription",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await page.getByRole("button", { name: "Type", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("Later context");
  await page.route(`${speechURL}/v1/transcriptions`, (route) =>
    route.fulfill({
      json: result(metadata(route.request()), "Voice context"),
    }),
  );
  await retry.click();
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Captured context\n\nVoice context",
  );
  await expect(input).toHaveValue("Later context");
});

test("a new attempt captures the latest draft and vocabulary instead of retaining the failed attempt", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Original context");
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  const requests: ReturnType<typeof metadata>[] = [];
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    requests.push(metadata(route.request()));
    return requests.length === 1
      ? route.abort("connectionreset")
      : route.fulfill({
          json: result(metadata(route.request()), "Fresh voice context"),
        });
  });
  await record(page);
  await expect(
    page.getByRole("button", { name: "Retry same transcription", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Type", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("Updated context");
  await page.route("**/api/rpc/voxpilot/vocabulary**", (route) =>
    route.fulfill({
      json: { output: vocabulary(["SolidJS"]) },
    }),
  );
  await page
    .getByRole("button", { name: "Start a new paid attempt…", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm new paid attempt", exact: true })
    .click();
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Updated context\n\nFresh voice context",
  );
  await expect(input).toBeEmpty();
  expect(requests).toHaveLength(2);
  expect(requests[0]?.vocabulary).toEqual(["VoxPilot", "Incus"]);
  expect(requests[1]?.vocabulary).toEqual(["SolidJS"]);
  expect(requests[1]?.id).not.toBe(requests[0]?.id);
});

test("transport failure has no automatic retry, same-ID/body explicit retry, and uncertain new-attempt warning", async ({
  page,
}) => {
  await mount(page);
  const bodies: string[] = [];
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    bodies.push(JSON.stringify(metadata(route.request())));
    return bodies.length === 1
      ? route.abort("connectionreset")
      : route.fulfill({ json: result(metadata(route.request())) });
  });
  await record(page);
  await expect(
    page.getByRole("button", { name: "Retry same transcription", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-error",
    "true",
  );
  expect(bodies).toHaveLength(1);
  await page
    .getByRole("button", { name: "Start a new paid attempt…", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm new paid attempt", exact: true }),
  ).toBeVisible();
  expect(bodies).toHaveLength(1);
  await page
    .getByRole("button", { name: "Retry same transcription", exact: true })
    .click();
  await expect(page.getByLabel("Sent message")).not.toBeEmpty();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
});

for (const event of [
  "switch-session",
  "switch-project",
  "switch-backend",
  "cancel",
]) {
  test(`${event} during transcription cannot misroute or send a late result`, async ({
    page,
  }) => {
    await mount(page);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let cancelled: string | undefined;
    await page.route(`${speechURL}/v1/transcriptions/*`, (route) => {
      cancelled = route.request().url().split("/").at(-1);
      return route.fulfill({ json: { id: cancelled, cancelled: true } });
    });
    await page.route(`${speechURL}/v1/transcriptions`, async (route) => {
      const input = metadata(route.request());
      await held;
      await route
        .fulfill({ json: result(input, "Original session transcript") })
        .catch(() => {});
    });
    const request = page.waitForRequest(`${speechURL}/v1/transcriptions`);
    await record(page);
    await request;
    if (event === "cancel")
      await page
        .getByRole("button", { name: "Cancel transcription", exact: true })
        .click();
    else
      await page.evaluate(
        (name) => document.dispatchEvent(new Event(name)),
        event,
      );
    release();
    if (event === "switch-session" || event === "switch-project") {
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const url = "/src/features/chat/create-composer-draft.ts";
            const {
              composerDraft,
            }: typeof import("../src/features/chat/create-composer-draft") =
              await import(url);
            return composerDraft("first").text();
          }),
        )
        .toBe("Original session transcript");
      if (event === "switch-session")
        await page.evaluate(() =>
          document.dispatchEvent(new Event("switch-session")),
        );
      await expect(
        page.getByRole("status", { name: "Transcription status", exact: true }),
      ).toContainText("session or project changed");
      await page.getByRole("button", { name: "Type", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Message", exact: true }),
      ).toHaveValue("Original session transcript");
    } else {
      await expect.poll(() => cancelled).toBeTruthy();
      await expect(page.locator("audio")).toHaveCount(0);
    }
    await expect(page.getByLabel("Sent message")).toBeEmpty();
  });
}

test("new-chat draft relocation consumes the accepted original snapshot and recording", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => document.dispatchEvent(new Event("new-session")));
  await page
    .getByLabel("Sent message")
    .evaluate((element) => element.setAttribute("data-create-session", "true"));
  await paste(page, "New-chat reference");
  await page.route(`${speechURL}/v1/transcriptions`, (route) =>
    route.fulfill({
      json: result(metadata(route.request()), "Create this chat"),
    }),
  );
  await record(page);
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Create this chat\n\nPasted item 1:\nNew-chat reference",
  );
  await expect(page.getByLabel("Recorded audio")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview item 1", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
});

test("duplicate activation sends once and consumes only the captured text/reference/image snapshot", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Captured original text");
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await paste(page, "Captured original reference");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(`${speechURL}/v1/transcriptions`, async (route) => {
    requests++;
    const input = metadata(route.request());
    await held;
    await route.fulfill({ json: result(input, "Captured voice text") });
  });
  const requested = page.waitForRequest(`${speechURL}/v1/transcriptions`);
  await record(page, undefined, true);
  await requested;
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Later typed draft must survive");
  await paste(page, "Later reference must survive");
  await page.getByLabel("Attach images", { exact: true }).setInputFiles({
    name: "later.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM2kAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const status = await page.evaluate(async () => {
    const url = "/src/features/chat/create-composer-draft.ts";
    const {
      composerDraft,
    }: typeof import("../src/features/chat/create-composer-draft") =
      await import(url);
    const current = composerDraft("first");
    return {
      sending: current.sending(),
      files: current.attachments().map((entry) => entry.file.name),
      errors: current.errors(),
    };
  });
  expect(status).toEqual({ sending: false, files: ["later.png"], errors: [] });
  expect(
    await page.getByLabel("Sent message").getAttribute("data-error-message"),
  ).toBeNull();
  await expect(
    page.getByRole("button", { name: "Remove later.png", exact: true }),
  ).toBeVisible();
  release();
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Captured original text\n\nCaptured voice text\n\nPasted item 1:\nCaptured original reference",
  );
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-sends",
    "1",
  );
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-files",
    "",
  );
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Later typed draft must survive");
  await expect(
    page.getByRole("button", { name: "Preview item 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove later.png", exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
});

test("provider failure caches same-ID retries and new paid attempt requires explicit confirmation", async ({
  page,
}) => {
  await mount(page);
  const ids: string[] = [];
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    const input = metadata(route.request());
    ids.push(input.id);
    if (ids.length === 3) return route.fulfill({ json: result(input) });
    return route.fulfill({
      status: 502,
      json: {
        error: {
          code: "provider_failed",
          message: "Provider failed safely.",
          retryable: true,
          providerMayHaveProcessed: true,
        },
      },
    });
  });
  await record(page);
  await expect(
    page.getByRole("button", { name: "Retry same transcription", exact: true }),
  ).toBeVisible();
  expect(ids).toHaveLength(1);
  await page
    .getByRole("button", { name: "Retry same transcription", exact: true })
    .click();
  await expect.poll(() => ids.length).toBe(2);
  await expect(
    page.getByRole("button", {
      name: "Start a new paid attempt…",
      exact: true,
    }),
  ).toBeVisible();
  expect(ids[0]).toBe(ids[1]);
  await page
    .getByRole("button", { name: "Start a new paid attempt…", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm new paid attempt", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm new paid attempt", exact: true })
    .click();
  await expect.poll(() => ids.length).toBe(3);
  expect(ids[2]).not.toBe(ids[0]);
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-sends",
    "1",
  );
});

test("speech redirects and unauthorized capability responses fail before audio upload", async ({
  page,
}) => {
  await mount(page);
  let uploads = 0;
  let redirected = 0;
  page.on("request", (request) => {
    if (request.url() === `${speechURL}/v1/transcriptions`) uploads++;
    if (request.url().startsWith("https://untrusted.example.invalid"))
      redirected++;
  });
  await page.route(`${speechURL}/v1/capabilities`, (route) =>
    route.fulfill({
      status: 307,
      headers: { location: "https://untrusted.example.invalid" },
    }),
  );
  await record(page);
  await expect(
    page.getByRole("status", { name: "Transcription status", exact: true }),
  ).toContainText("Could not prepare transcription");
  expect(uploads).toBe(0);
  expect(redirected).toBe(0);
  await page.route(`${speechURL}/v1/capabilities`, (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: {
          code: "unauthorized",
          message: "Speech token is invalid.",
          retryable: false,
          providerMayHaveProcessed: false,
        },
      },
    }),
  );
  await page
    .getByRole("button", { name: "Retry same transcription", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Transcription status", exact: true }),
  ).toContainText("Speech token is invalid");
  expect(uploads).toBe(0);
});

test("immediate retry after cancel cannot be overwritten by the old aborted request", async ({
  page,
}) => {
  await mount(page);
  const ids: string[] = [];
  let releaseFirst = () => {};
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route(`${speechURL}/v1/transcriptions/*`, (route) =>
    route.fulfill({
      json: { id: route.request().url().split("/").at(-1), cancelled: true },
    }),
  );
  await page.route(`${speechURL}/v1/transcriptions`, async (route) => {
    const input = metadata(route.request());
    ids.push(input.id);
    if (ids.length === 1) {
      await first;
      await route
        .fulfill({ json: result(input, "Ignored cancelled result") })
        .catch(() => {});
    } else
      await route.fulfill({ json: result(input, "Explicit retry result") });
  });
  const firstRequest = page.waitForRequest(`${speechURL}/v1/transcriptions`);
  await record(page);
  await firstRequest;
  await page
    .getByRole("button", { name: "Cancel transcription", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry same transcription", exact: true })
    .click();
  releaseFirst();
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Explicit retry result",
  );
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-sends",
    "1",
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

test("backend change stops an active microphone and cannot attach a late recording", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
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
      return stream;
    };
  });
  await page
    .getByRole("button", { name: "Record a message", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish recording", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("switch-backend")),
  );
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-track",
    "ended",
  );
  await expect(page.getByLabel("Recorded audio")).toHaveCount(0);
  await expect(page.getByLabel("Sent message")).toBeEmpty();
});

test("malformed vocabulary shows a persistent error before recording", async ({
  page,
}) => {
  await mount(page, {
    vocabulary: { ...vocabulary(), terms: ["<malformed>"] },
  });
  let uploads = 0;
  page.on("request", (request) => {
    if (request.url() === `${speechURL}/v1/transcriptions`) uploads++;
  });
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("status", { name: "Vocabulary status", exact: true }),
  ).toContainText("Could not load speech vocabulary");
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Vocabulary status", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Typing still works");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Typing still works",
  );
  expect(uploads).toBe(0);
});

for (const terms of [
  Array.from({ length: 31 }, (_, index) => `Term${index}`),
  Array.from({ length: 20 }, (_, index) => `${index}${"a".repeat(100)}`),
]) {
  test(`oversize vocabulary (${terms.length} terms) blocks recording until files are fixed and refreshed`, async ({
    page,
  }) => {
    await mount(page, { vocabulary: vocabulary(terms) });
    let uploads = 0;
    await page.route(`${speechURL}/v1/transcriptions`, (route) => {
      uploads++;
      expect(metadata(route.request()).vocabulary).toEqual(["VoxPilot"]);
      return route.fulfill({ json: result(metadata(route.request())) });
    });
    const recordButton = page.getByRole("button", {
      name: "Record a message",
      exact: true,
    });
    await expect(recordButton).toBeDisabled();
    const error = page.getByRole("status", {
      name: "Vocabulary status",
      exact: true,
    });
    await expect(error).toContainText(
      `${terms.length} terms / ${terms.reduce((total, term) => total + term.length, 0)} characters`,
    );
    await expect(error).toContainText("30 terms / 2000 characters");
    await expect(
      page.getByRole("group", {
        name: "Choose vocabulary subset",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(uploads).toBe(0);
    await page.route("**/api/rpc/voxpilot/vocabulary**", (route) =>
      route.fulfill({ json: { output: vocabulary(["VoxPilot"]) } }),
    );
    await page
      .getByRole("button", { name: "Refresh vocabulary", exact: true })
      .click();
    await expect(error).toHaveCount(0);
    await expect(recordButton).toBeEnabled();
    await record(page);
    await expect(page.getByLabel("Sent message")).not.toBeEmpty();
    expect(uploads).toBe(1);
  });
}

test("vocabulary validation finishes before recording, while Type stays usable", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mount(page);
  await page.route("**/api/rpc/voxpilot/vocabulary**", async (route) => {
    await held;
    await route.fulfill({ json: { output: vocabulary() } });
  });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("switch-project")),
  );
  await expect(
    page.getByRole("status", { name: "Vocabulary status", exact: true }),
  ).toHaveText("Checking speech vocabulary…");
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("No need to wait for voice");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Sent message")).toHaveText(
    "No need to wait for voice",
  );
  release();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
});

test("vocabulary edits during recording are rejected before upload and can be refreshed", async ({
  page,
}) => {
  await mount(page);
  let uploads = 0;
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    uploads++;
    return route.fulfill({ json: result(metadata(route.request())) });
  });
  await record(page, async () => {
    await page.route("**/api/rpc/voxpilot/vocabulary**", (route) =>
      route.fulfill({
        json: {
          output: vocabulary(
            Array.from({ length: 31 }, (_, index) => `Term${index}`),
          ),
        },
      }),
    );
  });
  await expect(
    page.getByRole("status", { name: "Vocabulary status", exact: true }),
  ).toContainText("31 terms");
  await expect(
    page.getByRole("status", { name: "Transcription status", exact: true }),
  ).toContainText("31 terms");
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeDisabled();
  expect(uploads).toBe(0);
  await page.route("**/api/rpc/voxpilot/vocabulary**", (route) =>
    route.fulfill({ json: { output: vocabulary() } }),
  );
  await page
    .getByRole("button", { name: "Refresh vocabulary", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Vocabulary status", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Retry same transcription", exact: true })
    .click();
  await expect(page.getByLabel("Sent message")).not.toBeEmpty();
  expect(uploads).toBe(1);
});

for (const speech of [
  {},
  { url: speechURL },
  { url: "http://speech.example.invalid", token },
  { url: `${speechURL}/?token=forbidden`, token },
  { url: "https://user:pass@speech.example.invalid", token },
  { url: `${speechURL}/#fragment`, token },
]) {
  test(`invalid/missing speech credentials or URL (${JSON.stringify(speech).replace(token, "test-token")}) disables cloud recording and leaves Type usable`, async ({
    page,
  }) => {
    await mount(page, { speech });
    await expect(
      page.getByRole("button", { name: "Record a message", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Type", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Typing fallback");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByLabel("Sent message")).toHaveText("Typing fallback");
  });
}

test("idle, recording and cloud-busy production controls fit narrow dark/light screens", async ({
  page,
}, info) => {
  await mount(page);
  await paste(page, `https://example.com/${"long-path".repeat(40)}`);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${speechURL}/v1/transcriptions`, async (route) => {
    const input = metadata(route.request());
    await held;
    await route.fulfill({ json: result(input) });
  });
  async function fits(state: string, control: string) {
    for (const colorScheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(
          page.getByRole("button", { name: control, exact: true }),
        ).toBeInViewport();
        expect(
          await page.locator("body").evaluate((element) => element.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await expect(page.locator("audio")).toHaveCount(0);
        await expect(page.getByRole("checkbox")).toHaveCount(0);
        await info.attach(`production-voice-${state}-${colorScheme}-${width}`, {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      }
    }
  }
  await fits("idle", "Record a message");
  await record(page, () => fits("recording", "Finish recording"));
  await expect(
    page.getByRole("button", { name: "Cancel transcription", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Record a message", exact: true })
      .and(page.locator(":enabled")),
  ).toHaveCount(0);
  await fits("busy", "Cancel transcription");
  release();
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-sends",
    "1",
  );
});

for (const recovery of ["failed", "cancelled", "no_speech", "ready"] as const) {
  test(`new Record after ${recovery} replaces the take and preserves text, numbered references and images`, async ({
    page,
  }) => {
    await mount(page);
    await page.getByRole("button", { name: "Type", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Keep typed context");
    await page.getByLabel("Attach images", { exact: true }).setInputFiles({
      name: "kept.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM2kAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.getByRole("button", { name: "Voice", exact: true }).click();
    await paste(page, "Keep numbered reference");
    if (recovery === "ready")
      await page
        .getByLabel("Sent message")
        .evaluate((element) => element.setAttribute("data-accept", "false"));
    const ids: string[] = [];
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`${speechURL}/v1/transcriptions/*`, (route) =>
      route.fulfill({
        json: { id: route.request().url().split("/").at(-1), cancelled: true },
      }),
    );
    await page.route(`${speechURL}/v1/transcriptions`, async (route) => {
      const input = metadata(route.request());
      ids.push(input.id);
      if (ids.length !== 1)
        return route.fulfill({
          json: result(input, "Fresh replacement transcript"),
        });
      if (recovery === "failed") return route.abort("connectionreset");
      if (recovery === "cancelled") {
        await held;
        return route
          .fulfill({ json: result(input, "Ignored old result") })
          .catch(() => {});
      }
      return route.fulfill({
        json: result(
          input,
          recovery === "no_speech" ? "" : "Retained first transcript",
        ),
      });
    });
    await record(page);
    if (recovery === "cancelled") {
      await expect.poll(() => ids.length).toBe(1);
      await page
        .getByRole("button", { name: "Cancel transcription", exact: true })
        .click();
      release();
    } else {
      await expect(
        page.getByRole("button", {
          name:
            recovery === "failed"
              ? "Retry same transcription"
              : recovery === "ready"
                ? "Send transcript"
                : "Discard recording",
          exact: true,
        }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "Record a message", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("audio")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Preview item 1", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove kept.png", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Sent message")
      .evaluate((element) => element.setAttribute("data-accept", "true"));
    await record(page);
    await expect(page.getByLabel("Sent message")).toContainText(
      "Keep typed context",
    );
    await expect(page.getByLabel("Sent message")).toContainText(
      "Fresh replacement transcript",
    );
    await expect(page.getByLabel("Sent message")).toContainText(
      "Pasted item 1:\nKeep numbered reference",
    );
    await expect(page.getByLabel("Sent message")).toHaveAttribute(
      "data-files",
      "kept.png",
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
}

test("Discard recording clears only transient audio/take and allows Type fallback without another cloud call", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Keep this text");
  await page.getByLabel("Attach images", { exact: true }).setInputFiles({
    name: "discard-kept.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM2kAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await paste(page, "Keep this reference");
  let requests = 0;
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    requests++;
    return route.abort("connectionreset");
  });
  await record(page);
  await expect(
    page.getByRole("button", { name: "Retry same transcription", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Discard recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry same transcription", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Keep this text");
  await expect(
    page.getByRole("button", { name: "Remove discard-kept.png", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Keep this text\n\nPasted item 1:\nKeep this reference",
  );
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-files",
    "discard-kept.png",
  );
  expect(requests).toBe(1);
});

for (const ending of ["track-ended", "duration-cap"] as const) {
  test(`${ending} completes full raw audio and automatically transcribes/sends once`, async ({
    page,
  }) => {
    await mount(page);
    await page.evaluate(() => {
      const acquire = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await acquire(constraints);
        document.addEventListener(
          "end-track",
          () => stream.getAudioTracks()[0]?.dispatchEvent(new Event("ended")),
          { once: true },
        );
        return stream;
      };
      const now = performance.now.bind(performance);
      let elapsed = 0;
      performance.now = () => now() + elapsed;
      document.addEventListener(
        "advance-recording-time",
        () => {
          elapsed = 300_000;
        },
        { once: true },
      );
    });
    let calls = 0;
    await page.route(`${speechURL}/v1/transcriptions`, (route) => {
      calls++;
      const input = metadata(route.request());
      expect(route.request().postDataBuffer()?.byteLength).toBeGreaterThan(500);
      if (ending === "duration-cap") expect(input.durationSeconds).toBe(300);
      return route.fulfill({ json: result(input) });
    });
    await page
      .getByRole("button", { name: "Record a message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Finish recording", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(() => page.getByRole("timer").textContent())
      .not.toBe("0:00");
    await page.evaluate(
      (event) => document.dispatchEvent(new Event(event)),
      ending === "track-ended" ? "end-track" : "advance-recording-time",
    );
    await expect(page.getByLabel("Sent message")).toHaveAttribute(
      "data-sends",
      "1",
    );
    expect(calls).toBe(1);
    await expect(page.locator("audio")).toHaveCount(0);
  });
}

for (const pendingPermission of [false, true]) {
  test(`hidden document cancels/discards ${pendingPermission ? "pending permission" : "active microphone"} without saving or uploading`, async ({
    page,
  }) => {
    await mount(page);
    let uploads = 0;
    page.on("request", (request) => {
      if (request.url() === `${speechURL}/v1/transcriptions`) uploads++;
    });
    await page.evaluate((pending) => {
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
          ?.setAttribute("data-permission", "acquired");
        if (pending)
          await new Promise<void>((resolve) =>
            document.addEventListener("release-permission", () => resolve(), {
              once: true,
            }),
          );
        return stream;
      };
    }, pendingPermission);
    await page
      .getByRole("button", { name: "Record a message", exact: true })
      .click();
    await expect(page.getByLabel("Sent message")).toHaveAttribute(
      "data-permission",
      "acquired",
    );
    if (!pendingPermission)
      await expect(
        page.getByRole("button", { name: "Finish recording", exact: true }),
      ).toBeEnabled();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("release-permission"));
    });
    await expect(page.getByLabel("Sent message")).toHaveAttribute(
      "data-track",
      "ended",
    );
    await expect(
      page.getByRole("button", { name: "Record a message", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Discard recording", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Sent message")).toBeEmpty();
    expect(uploads).toBe(0);
  });
}

for (const action of [
  "switch-session",
  "switch-backend",
  "dispose-composer",
  "cancel-recording",
]) {
  test(`${action} while microphone permission is pending stops late tracks and never uploads`, async ({
    page,
  }) => {
    await mount(page);
    let uploads = 0;
    page.on("request", (request) => {
      if (request.url() === `${speechURL}/v1/transcriptions`) uploads++;
    });
    await page.evaluate(() => {
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
        await new Promise<void>((resolve) =>
          document.addEventListener("release-permission", () => resolve(), {
            once: true,
          }),
        );
        return stream;
      };
    });
    await page
      .getByRole("button", { name: "Record a message", exact: true })
      .click();
    await expect(page.getByLabel("Sent message")).toHaveAttribute(
      "data-permission",
      "waiting",
    );
    if (action === "cancel-recording")
      await page
        .getByRole("button", { name: "Cancel recording", exact: true })
        .click();
    else
      await page.evaluate(
        (event) => document.dispatchEvent(new Event(event)),
        action,
      );
    await page.evaluate(() =>
      document.dispatchEvent(new Event("release-permission")),
    );
    await expect(page.getByLabel("Sent message")).toHaveAttribute(
      "data-track",
      "ended",
    );
    await expect(
      page.getByRole("button", { name: "Finish recording", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Discard recording", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Sent message")).toBeEmpty();
    expect(uploads).toBe(0);
  });
}

test("project captured before microphone permission awaits owns vocabulary and transcript even after project changes", async ({
  page,
}) => {
  await mount(page);
  await page.route("**/api/rpc/voxpilot/vocabulary**", (route) => {
    const directory = new URL(route.request().url()).searchParams.get(
      "location[directory]",
    );
    return route.fulfill({
      json: {
        output: vocabulary(
          directory === "/fixture/original-project"
            ? ["VoxPilot", "Incus"]
            : ["OtherProject"],
        ),
      },
    });
  });
  await page.evaluate(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await acquire(constraints);
      document
        .querySelector("output")
        ?.setAttribute("data-permission", "waiting");
      await new Promise<void>((resolve) =>
        document.addEventListener("release-permission", () => resolve(), {
          once: true,
        }),
      );
      return stream;
    };
  });
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    const input = metadata(route.request());
    expect(input.vocabulary).toEqual(["VoxPilot", "Incus"]);
    return route.fulfill({
      json: result(input, "Original project transcript"),
    });
  });
  await page
    .getByRole("button", { name: "Record a message", exact: true })
    .click();
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-permission",
    "waiting",
  );
  await page.evaluate(() => {
    document.dispatchEvent(new Event("switch-project"));
    document.dispatchEvent(new Event("release-permission"));
  });
  await expect(
    page.getByRole("button", { name: "Finish recording", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() => page.getByRole("timer").textContent())
    .not.toBe("0:00");
  await page
    .getByRole("button", { name: "Finish recording", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Transcription status", exact: true }),
  ).toContainText("session or project changed");
  await expect(page.getByLabel("Sent message")).toBeEmpty();
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Original project transcript");
});

test("streaming disables new recording while preserving Type, Paste and the stop action", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("start-streaming")),
  );
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Stop generating", exact: true }),
  ).toBeVisible();
  await paste(page, "Reference while streaming");
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Next typed message");
  await expect(
    page.getByRole("button", { name: "Preview item 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("stop-streaming")),
  );
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
});

test("Type correction after thrown prompt admission preserves transcript and references without a new paid request", async ({
  page,
}) => {
  await mount(page);
  await page
    .getByLabel("Sent message")
    .evaluate((element) => element.setAttribute("data-throw-send", "true"));
  await paste(page, "Reference retained after thrown admission");
  let requests = 0;
  await page.route(`${speechURL}/v1/transcriptions`, (route) => {
    requests++;
    return route.fulfill({
      json: result(metadata(route.request()), "Transcript before correction"),
    });
  });
  await record(page);
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-error-message",
    "Prompt admission failed",
  );
  await expect(
    page.getByRole("button", { name: "Send transcript", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Type", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(input).toHaveValue("Transcript before correction");
  await input.fill("Corrected staging destination");
  await page
    .getByLabel("Sent message")
    .evaluate((element) => element.removeAttribute("data-throw-send"));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Corrected staging destination\n\nPasted item 1:\nReference retained after thrown admission",
  );
  await expect(input).toBeEmpty();
  await expect(
    page.getByRole("button", { name: "Discard recording", exact: true }),
  ).toHaveCount(0);
  expect(requests).toBe(1);
});
