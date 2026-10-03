import { expect, test } from "./browser";

test("mobile page loads and session picker opens without modifying data", async ({
  app,
}) => {
  await expect(app.getByPlaceholder("Send a message...")).toBeEnabled();
  await app.locator(".bottom-nav .session-title-btn").click();
  await expect(
    app.getByRole("heading", { name: "Sessions", exact: true }),
  ).toBeVisible();
  await app.locator(".picker-header button").click();
  await expect(app.getByRole("dialog")).toHaveCount(0);
  expect(
    await app.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("desktop page loads without horizontal overflow", async ({ app }) => {
  await app.setViewportSize({ width: 1440, height: 900 });
  await expect(
    app.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
  expect(
    await app.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("unknown session URL recovers to New Chat", async ({ app }) => {
  await app.goto(`${new URL(app.url()).origin}/#ses_browser_baseline_missing`);
  await app.reload({ waitUntil: "domcontentloaded" });
  await expect(
    app.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
  await expect.poll(() => new URL(app.url()).hash).toBe("");
});
