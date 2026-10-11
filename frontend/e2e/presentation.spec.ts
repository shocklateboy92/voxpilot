import { chromium } from "@playwright/test";
import { expect, idle, send, test } from "./browser";
import { markdownPrompt } from "./dev";

test("theme tokens, native controls, and reactive selection survive system-theme changes", async ({
  app,
}, info) => {
  const schemes: Array<"dark" | "light"> = ["dark", "light", "dark"];
  for (const scheme of schemes) {
    await app.emulateMedia({ colorScheme: scheme });
    const surface =
      scheme === "dark" ? "rgb(26, 29, 39)" : "rgb(255, 255, 255)";
    const accent = scheme === "dark" ? "rgb(59, 130, 246)" : "rgb(37, 99, 235)";
    await expect(app.locator("html")).toHaveCSS("color-scheme", scheme);
    await expect(app.locator("body")).toHaveCSS("background-color", surface);
    await expect(
      app.getByRole("button", { name: "Send", exact: true }),
    ).toHaveCSS("background-color", accent);
    await expect
      .poll(() =>
        app.locator('meta[name="theme-color"]').getAttribute("content"),
      )
      .toBe(scheme === "dark" ? "#1a1d27" : "#ffffff");

    const agents = app.getByRole("group", { name: "Agent", exact: true });
    const plan = agents.getByRole("button", {
      name: "Plan",
      exact: true,
    });
    const build = agents.getByRole("button", { name: "Build", exact: true });
    await plan.click();
    await expect(plan).toHaveAttribute("aria-pressed", "true");
    await expect(build).toHaveAttribute("aria-pressed", "false");
    await app.mouse.move(0, 0);
    await expect(plan).toHaveCSS("background-color", accent);
    await build.click();
    await expect(build).toHaveAttribute("aria-pressed", "true");
    await expect(plan).toHaveAttribute("aria-pressed", "false");
    await info.attach(`new-chat-${scheme}`, {
      body: await app.screenshot(),
      contentType: "image/png",
    });
  }
});

test("narrow layouts keep controls reachable and review rows below floating chrome", async ({
  app,
}, info) => {
  for (const width of [280, 320, 390, 480]) {
    await app.setViewportSize({ width, height: 844 });
    const sendButton = app.getByRole("button", { name: "Send", exact: true });
    await expect(sendButton).toBeInViewport();
    await expect(
      app.getByRole("button", { name: "New worktree", exact: true }),
    ).toBeInViewport();
    expect(
      await app.locator("body").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const bounds = await app
      .getByPlaceholder("Worktree name (optional)")
      .boundingBox();
    expect(bounds?.width).toBeGreaterThan(40);
  }
  await app.setViewportSize({ width: 390, height: 844 });
  await send(app, markdownPrompt);
  await expect(app.locator(".markdown-body")).toContainText(
    "Browser baseline passed.",
  );
  await idle(app);
  await expect(app.locator(".markdown-body ul")).toHaveCSS(
    "list-style-type",
    "disc",
  );
  await expect(app.locator(".markdown-body pre code")).toHaveCSS(
    "white-space",
    "pre",
  );
  await app
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await app.getByRole("button", { name: "Load changes", exact: true }).click();
  await app.locator(".changeset-file-row", { hasText: "sample.txt" }).click();
  const review = app.getByRole("dialog", { name: "File review" });
  await expect(review).toContainText("new baseline line");
  const header = await review.locator("[data-status-bar]").boundingBox();
  const firstRow = await review.locator(".fulltext-line").first().boundingBox();
  if (!header || !firstRow) throw new Error("Missing review geometry");
  expect(firstRow.y).toBeGreaterThanOrEqual(header.y + header.height);
  await info.attach("mobile-review", {
    body: await app.screenshot(),
    contentType: "image/png",
  });
});

test("bottom sheet contains keyboard focus, closes on Escape, and restores its trigger", async ({
  app,
}) => {
  const trigger = app.locator(".session-title-btn");
  await trigger.click();
  const dialog = app.getByRole("dialog", { name: "Sessions", exact: true });
  await expect(dialog).toBeFocused();
  await app.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "+ New chat", exact: true }),
  ).toBeFocused();
  await app.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await app.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("touch keyboard layout and safe-area variables remain coordinated", async ({
  app,
}) => {
  test.skip(
    Boolean(process.env.VOXPILOT_E2E_CDP),
    "Use an isolated browser for touch emulation",
  );
  const cdp = await app.context().newCDPSession(app);
  try {
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await app.evaluate(() => {
      document.documentElement.style.setProperty("--safe-top", "24px");
      document.documentElement.style.setProperty("--safe-bottom", "20px");
    });
    await send(app, markdownPrompt);
    await expect(app.locator(".markdown-body")).toContainText(
      "Browser baseline passed.",
    );
    await idle(app);
    const input = app.getByRole("textbox", { name: "Message", exact: true });
    await input.focus();
    await expect(app.locator("[data-bottom-nav]")).toBeHidden();
    await expect(app.locator(".app")).toHaveCSS("padding-bottom", "0px");
    await expect(app.locator("[data-status-bar]")).toHaveCSS("top", "48px");
    await input.evaluate((element) => element.blur());
    await expect(app.locator("[data-bottom-nav]")).toBeVisible();
    await expect(app.locator(".app")).toHaveCSS("padding-bottom", "68px");
  } finally {
    await cdp.detach();
  }
});

test("launch stays dark without JavaScript even when the system prefers light", async ({
  baseURL,
}) => {
  test.skip(
    Boolean(process.env.VOXPILOT_E2E_CDP),
    "Requires an isolated JavaScript-disabled browser",
  );
  if (!baseURL) throw new Error("Missing baseURL");
  const browser = await chromium.launch({
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
  });
  try {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      colorScheme: "light",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto(baseURL);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      "rgb(26, 29, 39)",
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#1a1d27",
    );
    await context.close();
  } finally {
    await browser.close();
  }
});
