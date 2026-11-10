import { chromium, type Page } from "@playwright/test";
import { renderMarkdown } from "../src/ui/markdown";
import { client, createWorkspace, model, modelKey, password } from "./dev";
import { test as base, expect } from "./fixtures";

export const test = base.extend<{
  app: Page;
  workspace: Awaited<ReturnType<typeof createWorkspace>>;
}>({
  workspace: [
    async ({ servers }, use) => {
      const workspace = await createWorkspace(servers.root);
      try {
        await use(workspace);
      } finally {
        await workspace.dispose();
      }
    },
    { scope: "test" },
  ],
  app: async ({ baseURL, workspace }, use, testInfo) => {
    if (baseURL === undefined) throw new Error("Missing browser test baseURL");
    const cdp = process.env.VOXPILOT_E2E_CDP;
    const browser = cdp
      ? await chromium.connectOverCDP(cdp)
      : await chromium.launch({
          executablePath:
            process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
        });
    const context = cdp ? browser.contexts()[0] : await browser.newContext();
    if (context === undefined)
      throw new Error("CDP browser has no existing context");
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const eventsReady = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/event" && response.ok(),
    );
    // Guard before sending a prompt, including tests that click Send directly.
    await page.route("**/api/session/*/prompt", async (route) => {
      const sessionID = new URL(route.request().url()).pathname
        .split("/")
        .at(-2);
      if (!sessionID) throw new Error("Missing prompt session ID");
      const session = await client.session.get({ sessionID });
      if (
        !session.location.directory.startsWith(`${workspace.root}/`) ||
        session.model?.providerID !== model.providerID ||
        session.model?.id !== model.id
      ) {
        await route.abort();
        throw new Error(
          `E2E prompts require ${modelKey} in the test workspace`,
        );
      }
      await route.continue();
    });
    try {
      // Keep existing scenarios on the manual flow regardless of local config.
      await page.route("**/config.json", (route) =>
        route.fulfill({ status: 404 }),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.bringToFront();
      // Exercise the connection form even when attaching to a logged-in browser.
      await page.goto(`${baseURL}/?connect=1`, {
        waitUntil: "domcontentloaded",
      });
      if (
        await page
          .getByRole("button", { name: "Connect", exact: true })
          .isVisible()
      ) {
        await page.getByLabel("Server URL").fill(baseURL);
        // Password managers can populate an input without dispatching input/change.
        // Assign the DOM value directly to cover that connection path.
        await page.getByLabel("Server password").evaluate((element, value) => {
          if (!(element instanceof HTMLInputElement))
            throw new Error("Password control is not an input");
          element.value = value;
        }, password);
        const infoRequest = page.waitForRequest((request) =>
          request.url().endsWith("/api/info"),
        );
        await page
          .getByRole("button", { name: "Connect", exact: true })
          .click();
        const headers = await (await infoRequest).allHeaders();
        if (password) expect(headers.authorization).toMatch(/^Basic /);
      }
      await expect(
        page.getByRole("heading", { name: "New Chat", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("combobox", { name: "Project", exact: true })
        .selectOption(workspace.directory);
      await page.getByRole("button", { name: "Build", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Model", exact: true })
        .selectOption(modelKey);
      await page
        .getByRole("combobox", { name: "Thinking level", exact: true })
        .selectOption(model.variant);
      // Native events are live-only: mutations must wait for the subscription.
      await eventsReady;
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
  await expect(
    page.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue(modelKey);
  const userMessages = page.locator(".message.user");
  const previousCount = await userMessages.count();
  const admitted = page.waitForResponse(
    (response) =>
      /^\/api\/session\/[^/]+\/prompt$/.test(
        new URL(response.url()).pathname,
      ) && response.request().method() === "POST",
  );
  await page.getByPlaceholder("Send a message...").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await admitted).ok(), "Prompt admission succeeded").toBe(true);
  await expect(userMessages).toHaveCount(previousCount + 1);
  await expect(userMessages.last()).toHaveText(prompt);
}

export async function idle(page: Page) {
  const sessionID = new URL(page.url()).hash.slice(1);
  if (!sessionID) throw new Error("Cannot wait for idle without a session");
  await client.session.wait(
    { sessionID },
    { signal: AbortSignal.timeout(60_000) },
  );
  await expect(
    page.getByRole("button", { name: "Stop generating", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
}

/** Compare against server truth so model wording cannot mask lost/duplicated events. */
export async function expectPersistedResponse(page: Page) {
  const sessionID = new URL(page.url()).hash.slice(1);
  await client.session.wait(
    { sessionID },
    { signal: AbortSignal.timeout(60_000) },
  );
  const messages = await client.message.list({
    sessionID,
    limit: 100,
    order: "asc",
  });
  const assistant = messages.data
    .filter((message) => message.type === "assistant")
    .at(-1);
  if (assistant?.type !== "assistant")
    throw new Error("Missing assistant response");
  expect(assistant.error).toBeUndefined();
  expect(assistant.model.providerID).toBe(model.providerID);
  expect(assistant.model.id).toBe(model.id);
  const text = assistant.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
  expect(text.length).toBeGreaterThan(1000);
  const expected = await page.evaluate((html) => {
    const element = document.createElement("div");
    element.innerHTML = html;
    return element.textContent ?? "";
  }, renderMarkdown(text));
  await expect(page.locator(".message.assistant .markdown-body")).toHaveText(
    expected,
  );
  await idle(page);
}
