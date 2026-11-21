import { chromium } from "@playwright/test";
import { expect, test } from "./browser";
import { assistant, history, openSession, user } from "./data";
import { markdownResponse, password } from "./dev";

test("floating reading controls share the status bar glass over scrolling code", async ({
  app,
  workspace,
}, info) => {
  await app.setViewportSize({ width: 390, height: 844 });
  const code = Array.from(
    { length: 140 },
    (_, i) => `const row${i} = "Dense scrolling content";`,
  ).join("\n");
  const session = await history(workspace.directory, "Floating controls", [
    assistant([{ type: "text", text: `\`\`\`ts\n${code}\n\`\`\`` }]),
  ]);
  await openSession(app, session.id, { reading: true });
  const pane = app.locator(".messages");
  await expect(pane.locator("pre")).toBeVisible();
  const expand = app.getByRole("button", { name: "Expand controls" });
  const scroll = app.getByRole("button", { name: "Scroll to bottom" });
  const status = app.locator("[data-status-bar]");
  await expect(expand).toBeVisible();
  await expect(scroll).toBeHidden();
  await pane.evaluate((element) => element.scrollBy(0, -450));
  await expect(scroll).toBeVisible();

  for (const scheme of ["dark", "light"] as const) {
    await app.emulateMedia({ colorScheme: scheme });
    await expect(app.locator("html")).toHaveCSS("color-scheme", scheme);
    const material = await status.evaluate((element) => {
      const style = getComputedStyle(element);
      return { tint: style.backgroundColor, filter: style.backdropFilter };
    });
    expect(material.filter).toContain("blur(");
    for (const button of [expand, scroll]) {
      await expect(button).toHaveCSS("background-color", material.tint);
      await expect(button).toHaveCSS("backdrop-filter", material.filter);
    }
    await info.attach(`floating-controls-${scheme}`, {
      body: await app.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
  }
  await scroll.click();
  await expect(scroll).toBeHidden();
});

test("status summary reveals full details without moving the conversation", async ({
  app,
  workspace,
}, info) => {
  const branch = `feature/${"a-very-long-branch-name-".repeat(7)}details`;
  await workspace.git("checkout", "-b", branch);
  const message = {
    ...assistant([{ type: "text", text: markdownResponse }]),
    tokens: {
      input: 106600,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  };
  const session = await history(workspace.directory, "Status details", [
    user("Status summary fixture"),
    message,
  ]);
  await openSession(app, session.id);
  const trigger = app.getByRole("button", {
    name: "Session status",
    exact: true,
  });
  const details = app.getByRole("region", { name: "Session status details" });
  const conversation = app.locator(".messages");
  await expect(trigger).toContainText(branch);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(details).toHaveCount(0);

  // Use real touch input for the disclosure on a narrow phone viewport.
  const cdp = await app.context().newCDPSession(app);
  try {
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    for (const scheme of ["dark", "light"] as const) {
      await app.emulateMedia({ colorScheme: scheme });
      for (const width of [280, 320, 369, 370, 390, 393, 414, 439, 440, 480]) {
        await app.setViewportSize({ width, height: 844 });
        const percentage = trigger.getByText(/^\(\d+%\)$/);
        await expect(percentage).toBeVisible();
        const percentBounds = await percentage.boundingBox();
        const chevronBounds = await trigger.locator("svg").last().boundingBox();
        const bounds = await trigger.boundingBox();
        if (!bounds || !percentBounds || !chevronBounds)
          throw new Error("Missing status summary geometry");
        expect(
          chevronBounds.x - (percentBounds.x + percentBounds.width),
        ).toBeGreaterThanOrEqual(6);
        expect(chevronBounds.x + chevronBounds.width).toBeLessThanOrEqual(
          bounds.x + bounds.width - 12,
        );
        const before = await conversation.evaluate((element) => ({
          top: element.getBoundingClientRect().top,
          scroll: element.scrollTop,
        }));
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
          ],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        await expect(details.getByText(branch, { exact: true })).toBeVisible();
        await expect(details).toContainText("2 changed files");
        await expect(details).toContainText("0 added · 2 modified · 0 deleted");
        await expect(details).toContainText("106,600");
        expect(
          await details.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
        expect(
          await conversation.evaluate((element) => ({
            top: element.getBoundingClientRect().top,
            scroll: element.scrollTop,
          })),
        ).toEqual(before);
        await info.attach(`status-details-${scheme}-${width}`, {
          body: await app.screenshot(),
          contentType: "image/png",
        });
        await trigger.click();
        await expect(details).toHaveCount(0);
      }
    }
  } finally {
    await cdp.detach();
  }

  await app.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await trigger.focus();
  await app.keyboard.press("Enter");
  const copy = details.getByRole("button", { name: "Copy branch name" });
  await app.keyboard.press("Tab");
  await expect(copy).toBeFocused();
  await copy.click();
  expect(await app.evaluate(() => navigator.clipboard.readText())).toBe(branch);
  await expect(details.getByRole("status")).toHaveText("Branch name copied");
  await trigger.click();
  await expect(details).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await app.keyboard.press("Space");
  await expect(details).toBeVisible();
  await app.getByRole("textbox", { name: "Message", exact: true }).click();
  await expect(details).toHaveCount(0);
});

test("theme tokens, native controls, and reactive selection survive system-theme changes", async ({
  app,
}, info) => {
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

    const servers = app.getByRole("group", { name: "Server", exact: true });
    const dev2 = servers.getByRole("button", { name: "Dev2", exact: true });
    const win3 = servers.getByRole("button", { name: "win3", exact: true });
    await win3.click();
    await expect(win3).toHaveAttribute("aria-pressed", "true");
    await expect(dev2).toHaveAttribute("aria-pressed", "false");
    await app.mouse.move(0, 0);
    await expect(win3).toHaveCSS("background-color", accent);
    await dev2.click();
    await expect(dev2).toHaveAttribute("aria-pressed", "true");
    await expect(win3).toHaveAttribute("aria-pressed", "false");
    await info.attach(`new-chat-${scheme}`, {
      body: await app.screenshot(),
      contentType: "image/png",
    });
  }
});

test("narrow layouts keep controls reachable and review rows below floating chrome", async ({
  app,
  workspace,
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
  const session = await history(workspace.directory, "Narrow layout", [
    user("Markdown layout fixture"),
    assistant([{ type: "text", text: markdownResponse }]),
  ]);
  await openSession(app, session.id);
  await expect(app.locator(".markdown-body")).toContainText(
    "Browser baseline passed.",
  );
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
  const review = app.getByRole("region", { name: "File review" });
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
  workspace,
}) => {
  test.skip(
    Boolean(process.env.VOXPILOT_E2E_CDP),
    "Use an isolated browser for touch emulation",
  );
  const session = await history(workspace.directory, "Touch keyboard layout", [
    user("Markdown layout fixture"),
    assistant([{ type: "text", text: markdownResponse }]),
  ]);
  await openSession(app, session.id);
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
    await expect(app.locator(".markdown-body")).toContainText(
      "Browser baseline passed.",
    );
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
