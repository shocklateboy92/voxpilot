import { password } from "./dev";
import { expect, test } from "./fixtures";

test.use({
  launchOptions: {
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
  },
});

test("configured servers connect without credential entry and survive reload and a fresh device", async ({
  page,
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing baseURL");
  const config = {
    servers: [
      {
        id: "first",
        name: "First server",
        url: baseURL,
        password: "incorrect",
      },
      { id: "dev2", name: "Dev2", url: baseURL, password },
    ],
  };
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: config }),
  );
  await page.goto("/");
  await expect(page.getByLabel("Server", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Server password")).toHaveCount(0);
  await page.getByLabel("Server", { exact: true }).selectOption("dev2");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Agent", exact: true }),
  ).toHaveCount(0);
  const servers = page.getByRole("group", { name: "Server", exact: true });
  await expect(
    servers.getByRole("button", { name: "Dev2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const stored = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(stored.local["voxpilot:serverId"]).toBe("dev2");
  expect(stored.local["voxpilot:server"]).toBeUndefined();
  expect(
    Object.keys(stored.session).filter((key) =>
      key.startsWith("voxpilot:password:"),
    ),
  ).toEqual([]);
  expect(JSON.stringify(stored)).not.toContain(password);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
  await page.goto("/?connect=1");
  await expect(page.getByLabel("Server", { exact: true })).toHaveValue("dev2");

  const device = await browser.newContext();
  try {
    const otherPage = await device.newPage();
    await otherPage.route("**/config.json", (route) =>
      route.fulfill({ json: { servers: [config.servers[1]] } }),
    );
    await otherPage.goto(baseURL);
    await otherPage
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect(
      otherPage.getByRole("heading", { name: "New Chat", exact: true }),
    ).toBeVisible();
  } finally {
    await device.close();
  }
});

test("removed server IDs require a new selection instead of reusing old credentials", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("voxpilot:serverId", "removed");
    localStorage.setItem("voxpilot:server", "https://stale.example.invalid");
    sessionStorage.setItem(
      "voxpilot:password:https://stale.example.invalid",
      "stale",
    );
  });
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        servers: [{ id: "dev2", name: "Dev2", url: baseURL, password }],
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByLabel("Server", { exact: true })).toHaveValue("dev2");
  await expect(page.getByLabel("Server password")).toHaveCount(0);
});

test("missing config retains the manual connection flow", async ({
  page,
  baseURL,
}) => {
  await page.route("**/config.json", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await page.getByLabel("Server URL").fill(baseURL ?? "");
  await page.getByLabel("Server password").fill(password);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
});

for (const scenario of [
  "invalid",
  "denied",
  "html",
  "duplicate",
  "unsafe URL",
  "empty",
]) {
  test(`${scenario} config fails closed without displaying secrets`, async ({
    page,
    baseURL,
  }) => {
    const secret = "config-secret-must-not-be-displayed";
    const server = { id: "dev2", name: "Dev2", url: baseURL, password: secret };
    await page.route("**/config.json", (route) => {
      if (scenario === "denied")
        return route.fulfill({ status: 403, body: secret });
      if (scenario === "html")
        return route.fulfill({
          contentType: "text/html",
          body: "<!doctype html>",
        });
      const json =
        scenario === "duplicate"
          ? { servers: [server, server] }
          : scenario === "unsafe URL"
            ? {
                servers: [
                  { ...server, url: "https://user:secret@example.com" },
                ],
              }
            : scenario === "empty"
              ? { servers: [] }
              : { servers: [{ ...server, url: secret }] };
      return route.fulfill({ json });
    });
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(
      "Could not load the server configuration",
    );
    await expect(
      page.getByRole("button", { name: "Connect", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(secret);
    if (scenario === "denied")
      await expect(page.getByRole("alert")).toContainText("HTTP 403");
  });
}

test("config requests bypass cache and credentials rotate on reload", async ({
  page,
  baseURL,
}) => {
  let currentPassword = "wrong-password";
  await page.addInitScript(() => {
    localStorage.setItem("voxpilot:serverId", "dev2");
    const original = window.fetch;
    window.fetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/config.json")) {
          document.documentElement.dataset.configCache = init?.cache;
          document.documentElement.dataset.configCredentials =
            init?.credentials;
        }
        return original(input, init);
      },
      { preconnect: original.preconnect },
    );
  });
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        servers: [
          { id: "dev2", name: "Dev2", url: baseURL, password: currentPassword },
        ],
      },
    }),
  );
  await page.goto("/?connect=1");
  await expect(page.locator("html")).toHaveAttribute(
    "data-config-cache",
    "no-store",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-config-credentials",
    "same-origin",
  );
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "New Chat", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  currentPassword = password;
  await page.reload();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
});
