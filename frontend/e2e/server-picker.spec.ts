import { expect, test } from "./browser";
import { history, openSession } from "./data";
import { password } from "./dev";

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
    if (view === "existing chat") {
      const session = await history(workspace.directory, "Server switching");
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

    await win3.click();
    await expect(win3).toHaveAttribute("aria-pressed", "true");
    await expect(dev2).toHaveAttribute("aria-pressed", "false");
    await expect(
      app.getByRole("heading", { name: "New Chat", exact: true }),
    ).toBeVisible();
    const destination = new URL(app.url());
    expect(destination.searchParams.get("serverId")).toBe("win3");
    expect(destination.searchParams.has("connect")).toBe(false);
    expect(destination.hash).toBe("");
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
