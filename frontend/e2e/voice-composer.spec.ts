import type { Page } from "@playwright/test";
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
  await page.route("**/voice-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<main></main><output aria-label="Sent message"></output>',
    }),
  );
  await page.goto("/voice-fixture");
  await page.evaluate(async () => {
    localStorage.removeItem("voxpilot-composer-mode");
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

test("voice is the keyboard-free default, typing preserves its draft and remembers the mode", async ({
  page,
}) => {
  await mountComposer(page);
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeVisible();
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

test("recording finishes into local playable audio without sending, survives mode and session switches", async ({
  page,
}, info) => {
  await mountComposer(page);
  let promptRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/prompt")) promptRequests += 1;
  });
  await page
    .getByRole("button", { name: "Record a message", exact: true })
    .click();
  const finish = page.getByRole("button", {
    name: "Finish recording",
    exact: true,
  });
  await expect(finish).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Type", exact: true }),
  ).toBeDisabled();
  // Prove actual audio was captured, not just an empty preview shell.
  await expect
    .poll(() => page.getByRole("timer").textContent())
    .not.toBe("0:00");
  await clipboard(page, "https://example.com/while-recording");
  await info.attach("voice-recording", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await finish.click();
  const audio = page.locator('audio[aria-label="Recorded audio"]');
  await expect(audio).toBeVisible();
  await expect
    .poll(() =>
      audio.evaluate(
        (element) =>
          element instanceof HTMLAudioElement && element.readyState >= 2,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("link", { name: "Save audio", exact: true }),
  ).toHaveAttribute("download", /voxpilot-recording\.(webm|m4a)/);
  await expect(page.getByLabel("Sent message")).toBeEmpty();
  await info.attach("voice-audio-preview", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(promptRequests).toBe(0);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(audio).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("switch-session")),
  );
  await expect(audio).toHaveCount(0);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("switch-session")),
  );
  await expect(audio).toBeVisible();
  await page
    .getByRole("button", { name: "Discard recording", exact: true })
    .click();
  await expect(audio).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
});

test("cancel stops microphone tracks and produces no recording", async ({
  page,
}) => {
  await mountComposer(page);
  await page.evaluate(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      const output = document.querySelector("output");
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          output?.setAttribute("data-track", track.readyState);
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
  await page
    .getByRole("button", { name: "Cancel recording", exact: true })
    .click();
  await expect(page.getByLabel("Sent message")).toHaveAttribute(
    "data-track",
    "ended",
  );
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
});

test("late permission cannot start a cancelled recording", async ({ page }) => {
  await mountComposer(page);
  await page.evaluate(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      const output = document.querySelector("output");
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          output?.setAttribute("data-track", track.readyState);
        };
      }
      output?.setAttribute("data-permission", "waiting");
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
    page.getByRole("button", { name: "Record a message", exact: true }),
  ).toBeEnabled();
});

for (const action of ["switch-session", "dispose-composer"]) {
  test(`${action} releases an active microphone without attaching audio to another session`, async ({
    page,
  }) => {
    await mountComposer(page);
    await page.evaluate(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await getUserMedia(constraints);
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
    await page.evaluate(
      (event) => document.dispatchEvent(new Event(event)),
      action,
    );
    await expect(page.getByLabel("Sent message")).toHaveAttribute(
      "data-track",
      "ended",
    );
    await expect(page.locator("audio")).toHaveCount(0);
    if (action === "switch-session") {
      await expect(
        page.getByRole("button", { name: "Record a message", exact: true }),
      ).toBeEnabled();
      await page.evaluate(() =>
        document.dispatchEvent(new Event("switch-session")),
      );
      await expect(page.locator("audio")).toHaveCount(0);
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
  ).toContainText("Recording needs HTTPS");
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
