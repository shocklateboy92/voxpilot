import { expect, idle, send, test } from "./browser";
import { history, openSession } from "./data";
import { longPrompt } from "./dev";

test("offline overlay can be dismissed, returns for a new outage, and recovers automatically", async ({
  app,
}) => {
  test.skip(
    Boolean(process.env.VOXPILOT_E2E_CDP),
    "Never take the shared browser offline",
  );
  const context = app.context();
  try {
    await context.setOffline(true);
    await expect(
      app.getByRole("heading", { name: "Devbox is offline" }),
    ).toBeVisible({ timeout: 15_000 });
    await app
      .getByRole("heading", { name: "Devbox is offline" })
      .locator("..")
      .getByRole("button", { name: "Dismiss", exact: true })
      .click();
    await expect(
      app.getByRole("heading", { name: "Devbox is offline" }),
    ).toHaveCount(0);
    await context.setOffline(false);
    // Wait for the normal probe to observe recovery before beginning a new outage.
    await app.waitForResponse(
      (response) => response.url().endsWith("/api/info") && response.ok(),
    );
    await context.setOffline(true);
    await expect(
      app.getByRole("heading", { name: "Devbox is offline" }),
    ).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
    await expect(
      app.getByRole("heading", { name: "Devbox is offline" }),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(
      app.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeEnabled();
  } finally {
    await context.setOffline(false);
  }
});

test("screen wake lock follows generation and is released when execution stops", async ({
  app,
  workspace,
}) => {
  test.skip(
    Boolean(process.env.VOXPILOT_E2E_CDP),
    "Device API instrumentation is isolated to this page",
  );
  await app.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, "e2eWakeCalls", { value: calls });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        async request() {
          calls.push("acquire");
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
  });
  const session = await history(workspace.directory, "Wake lock");
  await openSession(app, session.id);
  await send(app, longPrompt);
  await expect
    .poll(() => app.evaluate(() => Reflect.get(window, "e2eWakeCalls")))
    .toContain("acquire");
  await app
    .getByRole("button", { name: "Stop generating", exact: true })
    .click();
  await idle(app);
  await expect
    .poll(() => app.evaluate(() => Reflect.get(window, "e2eWakeCalls")))
    .toContain("release");
});

test("Wake Devbox sends only the configured wake request while the backend is unreachable", async ({
  app,
}) => {
  await app.route("**/api/rpc/voxpilot/config", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        output: { protocol: 1, wakeUrl: "http://localhost:13000/e2e-wake" },
      }),
    }),
  );
  await app.reload();
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await app.route("**/api/info", (route) => route.abort("connectionrefused"));
  await app.route("**/e2e-wake", (route) => route.fulfill({ status: 204 }));
  await expect(
    app.getByRole("heading", { name: "Devbox is offline" }),
  ).toBeVisible({ timeout: 15_000 });
  const wake = app.waitForRequest((request) =>
    request.url().endsWith("/e2e-wake"),
  );
  await app.getByRole("button", { name: "Wake Devbox", exact: true }).click();
  expect((await wake).method()).toBe("POST");
  await expect(
    app.getByRole("button", { name: "Waking...", exact: true }),
  ).toBeDisabled();
  await app.unroute("**/api/info");
  await expect(
    app.getByRole("heading", { name: "Devbox is offline" }),
  ).toHaveCount(0, { timeout: 15_000 });
});
