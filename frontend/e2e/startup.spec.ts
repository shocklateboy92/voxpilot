import { expect, test } from "@playwright/test";
import { password } from "./dev";

test.use({
  launchOptions: {
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
  },
});

test("chat module failures stay visible instead of redirecting back to Connect", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("voxpilot:serverId", "dev"),
  );
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        servers: [{ id: "dev", name: "Development", url: baseURL, password }],
      },
    }),
  );
  await page.route("**/src/app/App.tsx", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Failed to fetch dynamically imported module",
  );
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.has("connect")).toBe(false);
});
