import type { Page } from "@playwright/test";
import { expect, mount, test } from "./voice-test";

async function mockWakeLock(page: Page, mode = "normal") {
  await page.addInitScript((mode) => {
    const calls: string[] = [];
    Object.defineProperty(window, "wakeCalls", { value: calls });
    if (mode === "unsupported") {
      Reflect.deleteProperty(Navigator.prototype, "wakeLock");
      return;
    }
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        async request() {
          calls.push("acquire");
          if (mode === "denied")
            throw new DOMException("Denied", "NotAllowedError");
          if (mode === "pending")
            await new Promise<void>((resolve) =>
              document.addEventListener("resolve-wake-lock", () => resolve(), {
                once: true,
              }),
            );
          const sentinel = new EventTarget();
          return Object.assign(sentinel, {
            async release() {
              calls.push("release");
              sentinel.dispatchEvent(new Event("release"));
            },
          });
        },
      },
    });
  }, mode);
}

async function calls(page: Page) {
  return page.evaluate(() => Reflect.get(window, "wakeCalls"));
}

async function start(page: Page) {
  await page
    .getByRole("button", { name: "Record a message", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish recording", exact: true }),
  ).toBeEnabled();
}

for (const action of [
  "finish",
  "cancel",
  "dispose-composer",
  "switch-session",
]) {
  test(`recording holds a screen wake lock until ${action}`, async ({
    page,
  }) => {
    await mockWakeLock(page);
    await mount(page);
    expect(await calls(page)).toEqual([]);
    await start(page);
    await expect.poll(() => calls(page)).toEqual(["acquire"]);
    if (action === "finish" || action === "cancel")
      await page
        .getByRole("button", {
          name: action === "finish" ? "Finish recording" : "Cancel recording",
          exact: true,
        })
        .click();
    else
      await page.evaluate(
        (action) => document.dispatchEvent(new Event(action)),
        action,
      );
    await expect.poll(() => calls(page)).toEqual(["acquire", "release"]);
  });
}

for (const mode of ["unsupported", "denied"]) {
  test(`${mode} wake locks do not prevent recording`, async ({ page }) => {
    await mockWakeLock(page, mode);
    await mount(page);
    await start(page);
    await page
      .getByRole("button", { name: "Cancel recording", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Record a message", exact: true }),
    ).toBeEnabled();
    expect(await calls(page)).toEqual(mode === "denied" ? ["acquire"] : []);
    await expect(page.getByLabel("Sent message")).not.toHaveAttribute(
      "data-error",
      "true",
    );
  });
}

test("cancelling while acquisition is pending releases the late wake lock", async ({
  page,
}) => {
  await mockWakeLock(page, "pending");
  await mount(page);
  await start(page);
  await expect.poll(() => calls(page)).toEqual(["acquire"]);
  await page
    .getByRole("button", { name: "Cancel recording", exact: true })
    .click();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("resolve-wake-lock")),
  );
  await expect.poll(() => calls(page)).toEqual(["acquire", "release"]);
});

test("another activity keeps the shared wake lock after recording stops", async ({
  page,
}) => {
  await mockWakeLock(page);
  await mount(page);
  await start(page);
  await expect.poll(() => calls(page)).toEqual(["acquire"]);
  await page.evaluate(async () => {
    const url = "/src/platform/wake-lock.ts";
    const {
      requestScreenWakeLock,
    }: typeof import("../src/platform/wake-lock") = await import(url);
    document.addEventListener("stop-other-activity", requestScreenWakeLock(), {
      once: true,
    });
  });
  await page
    .getByRole("button", { name: "Cancel recording", exact: true })
    .click();
  expect(await calls(page)).toEqual(["acquire"]);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("stop-other-activity")),
  );
  await expect.poll(() => calls(page)).toEqual(["acquire", "release"]);
});
