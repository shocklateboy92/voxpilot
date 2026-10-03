import { test as base, chromium, expect, type Page } from "@playwright/test";

export const test = base.extend<{ app: Page }>({
  app: async ({ baseURL }, use, testInfo) => {
    if (baseURL === undefined) throw new Error("Missing browser test baseURL");
    const cdp = process.env.VOXPILOT_E2E_CDP;
    const browser = cdp
      ? await chromium.connectOverCDP(cdp)
      : await chromium.launch({
          executablePath:
            process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
        });
    const context = cdp
      ? browser.contexts()[0]
      : await browser.newContext({ serviceWorkers: "block" });
    if (context === undefined)
      throw new Error("CDP browser has no existing context");
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.bringToFront();
      await page.goto(baseURL, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: "New Chat", exact: true }),
      ).toBeVisible();
      await use(page);
      expect(errors, "Unhandled application errors").toEqual([]);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("browser-errors", {
          body: JSON.stringify(errors, null, 2),
          contentType: "application/json",
        });
        if (!page.isClosed()) {
          const screenshot = await page
            .screenshot({ fullPage: true, timeout: 5000 })
            .catch(() => undefined);
          if (screenshot)
            await testInfo.attach("failure", {
              body: screenshot,
              contentType: "image/png",
            });
        }
      }
      await page.close();
      if (!cdp) await context.close();
      // Disconnect from CDP; never close the user's browser or other tabs.
      await browser.close();
    }
  },
});

export { expect };

export async function send(page: Page, prompt: string) {
  await page.getByPlaceholder("Send a message...").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".message.user").last()).toHaveText(prompt);
}

export async function idle(page: Page) {
  await expect(
    page.getByRole("button", { name: "Stop generating", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
}
