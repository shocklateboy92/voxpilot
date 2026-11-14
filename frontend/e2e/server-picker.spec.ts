import { expect, test } from "./browser";
import { history, openSession } from "./data";
import { client, password } from "./dev";

for (const view of ["new chat", "existing chat"]) {
  test(`server selector switches in one tap from ${view} without changing the model picker`, async ({
    app,
    workspace,
  }) => {
    const serverUrl = new URL(app.url()).origin;
    await app.route("**/config.json", (route) =>
      route.fulfill({
        json: {
          servers: [
            { id: "dev2", name: "Dev2", url: serverUrl, password },
            { id: "win3", name: "win3", url: serverUrl, password },
          ],
        },
      }),
    );
    await app.evaluate(() => localStorage.setItem("voxpilot:serverId", "dev2"));
    const session = await history(workspace.directory, "Previous conversation");
    const latest = await history(workspace.directory, "Latest conversation");
    await client.session.create({
      title: "Recent sub-agent",
      location: { directory: workspace.directory },
      parentID: latest.id,
    });
    if (view === "existing chat") {
      await openSession(app, session.id);
    } else {
      await app.reload();
    }

    const servers = app.getByRole("group", { name: "Server", exact: true });
    const dev2 = servers.getByRole("button", { name: "Dev2", exact: true });
    const win3 = servers.getByRole("button", { name: "win3", exact: true });
    await expect(dev2).toHaveAttribute("aria-pressed", "true");
    await expect(
      app.getByRole("group", { name: "Agent", exact: true }),
    ).toHaveCount(0);
    await expect(
      app.getByRole("combobox", { name: "Model", exact: true }),
    ).toBeVisible();
    await app.setViewportSize({ width: 320, height: 844 });
    await expect(win3).toBeInViewport();
    expect(
      await app.locator("body").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(320);

    await app.addInitScript(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            const headings = node.matches("h1")
              ? [node]
              : node.querySelectorAll("h1");
            if (
              [...headings].some(
                (heading) => heading.textContent === "New Chat",
              )
            ) {
              document.documentElement.dataset.newChatMounted = "true";
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    let documents = 0;
    app.on("request", (request) => {
      if (
        request.isNavigationRequest() &&
        request.frame() === app.mainFrame()
      ) {
        documents++;
      }
    });
    await win3.click();
    await expect(win3).toHaveAttribute("aria-pressed", "true");
    await expect(dev2).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => new URL(app.url()).hash).toBe(`#${latest.id}`);
    await expect(app.locator(".session-title-btn")).toHaveText(
      "Latest conversation",
    );
    await expect(app.locator("html")).not.toHaveAttribute(
      "data-new-chat-mounted",
      "true",
    );
    expect(documents).toBe(1);
    const destination = new URL(app.url());
    expect(destination.searchParams.get("serverId")).toBe("win3");
    expect(destination.searchParams.has("connect")).toBe(false);
    expect(destination.searchParams.has("open")).toBe(false);
    expect(destination.hash).toBe(`#${latest.id}`);
    expect(
      await app.evaluate(() => localStorage.getItem("voxpilot:serverId")),
    ).toBe("win3");

    await app.reload();
    await expect(win3).toHaveAttribute("aria-pressed", "true");
    await dev2.click();
    await expect(dev2).toHaveAttribute("aria-pressed", "true");
    await expect(win3).toHaveAttribute("aria-pressed", "false");
  });
}

test("switching to an empty server consumes the landing hint and opens New Chat", async ({
  app,
}) => {
  const serverUrl = new URL(app.url()).origin;
  await app.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        servers: [
          { id: "dev2", name: "Dev2", url: serverUrl, password },
          { id: "win3", name: "win3", url: serverUrl, password },
        ],
      },
    }),
  );
  await app.evaluate(() => localStorage.setItem("voxpilot:serverId", "dev2"));
  await app.reload();
  await app
    .getByRole("group", { name: "Server", exact: true })
    .getByRole("button", { name: "win3", exact: true })
    .click();
  await expect(
    app
      .getByRole("group", { name: "Server", exact: true })
      .getByRole("button", { name: "win3", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    app.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
  const url = new URL(app.url());
  expect(url.searchParams.get("serverId")).toBe("win3");
  expect(url.searchParams.has("open")).toBe(false);
  expect(url.hash).toBe("");
});

test("latest landing preserves explicit chat links and does not follow newer sessions", async ({
  app,
  workspace,
}) => {
  const older = await history(workspace.directory, "Explicit destination");
  await history(workspace.directory, "More recent destination");
  const url = new URL(app.url());
  url.searchParams.set("open", "latest");
  url.hash = older.id;
  await app.goto("about:blank");
  await app.goto(url.href);
  await expect(app.locator(".session-title-btn")).toHaveText(
    "Explicit destination",
  );
  expect(new URL(app.url()).searchParams.has("open")).toBe(false);
  await history(workspace.directory, "New arrival");
  await expect(app.locator(".session-title-btn")).toHaveText(
    "Explicit destination",
  );
  expect(new URL(app.url()).hash).toBe(`#${older.id}`);
  await app.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(
    app.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
});

test("a failed server switch keeps the current selection and allows retry", async ({
  app,
}) => {
  const serverUrl = new URL(app.url()).origin;
  await app.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        servers: [
          { id: "dev2", name: "Dev2", url: serverUrl, password },
          { id: "win3", name: "win3", url: serverUrl, password: "incorrect" },
        ],
      },
    }),
  );
  await app.evaluate(() => localStorage.setItem("voxpilot:serverId", "dev2"));
  await app.reload();

  let releaseRequest = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await app.route("**/api/**", async (route) => {
    if (
      route.request().headers().authorization ===
      `Basic ${Buffer.from("opencode:incorrect").toString("base64")}`
    ) {
      await gate;
    }
    await route.continue();
  });
  const servers = app.getByRole("group", { name: "Server", exact: true });
  const dev2 = servers.getByRole("button", { name: "Dev2", exact: true });
  const win3 = servers.getByRole("button", { name: "win3", exact: true });
  const originalUrl = app.url();
  try {
    await win3.click();
    await expect(app.getByRole("status")).toHaveText("Connecting to win3…");
    await expect(dev2).toHaveAttribute("aria-pressed", "true");
    await expect(win3).toHaveAttribute("aria-pressed", "false");
    await expect(win3).toBeDisabled();
  } finally {
    releaseRequest();
  }
  await expect(app.getByRole("status")).toHaveCount(0);
  await expect(win3).toBeEnabled();
  await expect(dev2).toHaveAttribute("aria-pressed", "true");
  expect(app.url()).toBe(originalUrl);
  expect(
    await app.evaluate(() => localStorage.getItem("voxpilot:serverId")),
  ).toBe("dev2");
});
