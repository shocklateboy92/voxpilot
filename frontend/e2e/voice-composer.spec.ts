import type { Page } from "@playwright/test";
import { SpeechVocabulary } from "../../plugin/src/rpc";
import {
  SPEECH_MAX_BYTES,
  SPEECH_MAX_SECONDS,
  SPEECH_MAX_TERMS,
  SPEECH_MAX_VOCABULARY_CHARACTERS,
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

async function mountComposer(page: Page) {
  await page.route("**/api/provider", (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route("**/api/model", (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route("**/api/model/default", (route) =>
    route.fulfill({ json: {} }),
  );
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
        speech: {
          url: "https://speech.example.invalid",
          token: "test-speech-token-not-real-provider-credential",
        },
      },
    }),
  );
  await page.route("https://speech.example.invalid/v1/capabilities", (route) =>
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
  const source = {
    path: "fixture-vocabulary",
    exists: true,
    terms: ["VoxPilot"],
  };
  await page.route("**/api/rpc/voxpilot/vocabulary**", (route) =>
    route.fulfill({
      json: {
        output: SpeechVocabulary.parse({
          terms: source.terms,
          sources: { user: source, shared: source, local: source },
        }),
      },
    }),
  );
  // Fail closed if a microphone-only regression unexpectedly finishes a take.
  await page.route(
    "https://speech.example.invalid/v1/transcriptions**",
    (route) => route.abort("connectionreset"),
  );
  await page.route("**/voice-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<main></main><output aria-label="Sent message"></output>',
    }),
  );
  await page.goto("/voice-fixture");
  await page.evaluate(async () => {
    localStorage.removeItem("voxpilot-composer-mode");
    localStorage.setItem("voxpilot:serverId", "fixture");
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "/src/styles/app.css";
    document.head.append(style);
    const fixtureURL = "/e2e/voice-composer-fixture.ts";
    const { mount }: typeof import("./voice-composer-fixture") = await import(
      fixtureURL
    );
    mount();
  });
}

async function clipboard(page: Page, text: string) {
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

async function trackMicrophone(page: Page, pending = false) {
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

test("voice is the keyboard-free default, typing preserves its draft and remembers the mode", async ({
  page,
}) => {
  await mountComposer(page);
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
  for (const name of ["Record sample", "Upload test sample"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  }
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(input).toBeFocused();
  await input.fill("Compare the second item with this code.");
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(input).toHaveCount(0);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await expect(input).toHaveValue("Compare the second item with this code.");
  expect(
    await page.evaluate(() => localStorage.getItem("voxpilot-composer-mode")),
  ).toBe("text");
});

test("pasted items have stable numbers, exact previews and session-local ownership", async ({
  page,
}) => {
  await mountComposer(page);
  await clipboard(page, "https://example.com/first?q=one&exact=two");
  await clipboard(page, "Exact second item\n  with indentation");
  await page
    .getByRole("button", { name: "Remove item 1", exact: true })
    .click();
  await clipboard(page, "https://example.org/third");
  await expect(
    page.getByRole("button", { name: "Preview item 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview item 3", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview item 1", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Preview item 2", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Pasted item 2", exact: true })
      .locator("pre"),
  ).toHaveText("Exact second item\n  with indentation");
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    document.dispatchEvent(new Event("switch-session")),
  );
  await expect(
    page.getByRole("list", { name: "Pasted items", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("switch-session")),
  );
  await expect(
    page.getByRole("button", { name: "Preview item 2", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Use item 2.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Sent message")).toHaveText(
    "Use item 2.\n\nPasted item 2:\nExact second item\n  with indentation\n\nPasted item 3:\nhttps://example.org/third",
  );
  // Rejected sends keep the original numbers and contents for retry.
  await expect(
    page.getByRole("button", { name: "Preview item 2", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Sent message")
    .evaluate((element) => element.setAttribute("data-accept", "true"));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Pasted items", exact: true }),
  ).toHaveCount(0);
  await clipboard(page, "New draft");
  await expect(
    page.getByRole("button", { name: "Preview item 1", exact: true }),
  ).toBeVisible();
});

test("clipboard permission denial offers a native paste fallback", async ({
  page,
}) => {
  await mountComposer(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      },
    }),
  );
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Paste an item",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Pasted text", exact: true })
    .fill("https://example.com/native-paste");
  await dialog.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview item 1", exact: true }),
  ).toBeVisible();
});

test("live analyser updates microphone levels during production capture", async ({
  page,
}) => {
  await mountComposer(page);
  await page.evaluate(() => {
    const read = AnalyserNode.prototype.getByteFrequencyData;
    let loud = false;
    document.addEventListener("raise-microphone-level", () => {
      loud = true;
    });
    AnalyserNode.prototype.getByteFrequencyData = function (data) {
      read.call(this, data);
      data.fill(loud ? 255 : 0);
    };
  });
  await page
    .getByRole("button", { name: "Record a message", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish recording", exact: true }),
  ).toBeEnabled();
  const bars = page
    .getByRole("img", { name: "Microphone audio level", exact: true })
    .locator("span");
  await expect(bars).toHaveCount(25);
  await expect(bars.first()).toHaveCSS("height", "3px");
  await page.evaluate(() =>
    document.dispatchEvent(new Event("raise-microphone-level")),
  );
  await expect(bars.first()).toHaveCSS("height", "35px");
  await page
    .getByRole("button", { name: "Cancel recording", exact: true })
    .click();
  await expect(bars).toHaveCount(0);
  await expect(page.getByLabel("Sent message")).toBeEmpty();
});

test("cancel stops microphone tracks and produces no recording", async ({
  page,
}) => {
  await mountComposer(page);
  await trackMicrophone(page);
  await page
    .getByRole("button", { name: "Record a message", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish recording", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Cancel recording", exact: true })
    .click();
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-track",
    "ended",
  );
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Discard recording", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Sent message")).toBeEmpty();
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
});

test("late permission cannot start a cancelled recording", async ({ page }) => {
  await mountComposer(page);
  await trackMicrophone(page, true);
  await page
    .getByRole("button", { name: "Record a message", exact: true })
    .click();
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-permission",
    "waiting",
  );
  await page
    .getByRole("button", { name: "Cancel recording", exact: true })
    .click();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("release-permission")),
  );
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-track",
    "ended",
  );
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Discard recording", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
});

for (const action of ["switch-session", "dispose-composer"]) {
  test(`${action} releases an active microphone without attaching audio to another session`, async ({
    page,
  }) => {
    await mountComposer(page);
    await trackMicrophone(page);
    await page
      .getByRole("button", { name: "Record a message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Finish recording", exact: true }),
    ).toBeEnabled();
    await page.evaluate(
      (event) => document.dispatchEvent(new Event(event)),
      action,
    );
    await expect(page.getByLabel("Sent message")).toHaveAttribute(
      "data-track",
      "ended",
    );
    await expect(page.locator("audio")).toHaveCount(0);
    await expect(page.getByLabel("Sent message")).toBeEmpty();
    if (action === "switch-session") {
      await expect(
        page.getByRole("button", { name: "Record a message", exact: true }),
      ).toBeEnabled();
      await page.evaluate(() =>
        document.dispatchEvent(new Event("switch-session")),
      );
      await expect(
        page.getByRole("button", { name: "Discard recording", exact: true }),
      ).toHaveCount(0);
    }
  });
}

test("microphone permission rejection restores the controls and reaches the global rejection handler", async ({
  page,
}) => {
  await mountComposer(page);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(
        new DOMException("Microphone permission denied", "NotAllowedError"),
      );
    window.addEventListener(
      "unhandledrejection",
      (event) => {
        event.preventDefault();
        document
          .querySelector("output")
          ?.setAttribute(
            "data-error",
            event.reason instanceof Error
              ? event.reason.message
              : "Unexpected rejection",
          );
      },
      { once: true },
    );
  });
  await page
    .getByRole("button", { name: "Record a message", exact: true })
    .click();
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-error",
    "Microphone permission denied",
  );
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Type", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("audio")).toHaveCount(0);
});

test("unsupported recording leaves typing and pasting available", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: undefined,
    }),
  );
  await mountComposer(page);
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("status", { name: "Recording status", exact: true }),
  ).toContainText("Recording unavailable");
  await clipboard(page, "https://example.com/fallback");
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeEditable();
  await expect(
    page.getByRole("button", { name: "Preview item 1", exact: true }),
  ).toBeVisible();
});

test("numbered pills and controls fit narrow screens in both themes", async ({
  page,
}, info) => {
  await mountComposer(page);
  await clipboard(page, `https://example.com/${"very-long-path".repeat(30)}`);
  await clipboard(page, "Some pasted text");
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        page.getByRole("button", { name: "Type", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "Remove item 1", exact: true }),
      ).toBeInViewport();
      expect(
        await page.locator("body").evaluate((element) => element.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await info.attach(`voice-${colorScheme}-${width}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }
  }
});
