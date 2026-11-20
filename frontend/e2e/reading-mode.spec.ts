import { expect, send, test } from "./browser";
import { assistant, history, openSession, swipe, user } from "./data";
import { client } from "./dev";

test("the composer defaults to reading on an iPhone mini and opens on an iPad mini", async ({
  app,
  workspace,
}) => {
  await app.setViewportSize({ width: 375, height: 812 });
  const session = await history(workspace.directory, "Responsive composer");
  await openSession(app, session.id, { reading: true });
  const expand = app.getByRole("button", { name: "Expand controls" });
  const collapse = app.getByRole("button", { name: "Return to reading" });
  const input = app.getByRole("textbox", { name: "Message", exact: true });

  await expect(expand).toBeVisible();
  await expect(input).toBeHidden();
  await app.setViewportSize({ width: 744, height: 1133 });
  await expect(expand).toBeVisible();
  await app.reload({ waitUntil: "domcontentloaded" });
  await expect(input).toBeVisible();
  await expect(app.locator("[data-bottom-nav]")).toBeVisible();

  await collapse.click();
  await expect(input).toBeHidden();
  await expand.click();
  await expect(input).toBeVisible();
});

test("collapse shares the voice action row between Paste and Type", async ({
  app,
  workspace,
}) => {
  const session = await history(workspace.directory, "Inline collapse");
  await openSession(app, session.id);
  await app.getByRole("button", { name: "Voice", exact: true }).click();
  const collapse = app.getByRole("button", {
    name: "Return to reading",
    exact: true,
  });
  for (const width of [320, 375]) {
    await app.setViewportSize({ width, height: 812 });
    const paste = await app
      .getByRole("button", { name: "Paste", exact: true })
      .boundingBox();
    const button = await collapse.boundingBox();
    const type = await app
      .getByRole("button", { name: "Type", exact: true })
      .boundingBox();
    if (!paste || !button || !type) throw new Error("Missing composer actions");
    expect(button.x).toBeGreaterThanOrEqual(paste.x + paste.width);
    expect(button.x + button.width).toBeLessThanOrEqual(type.x);
    expect(button.height).toBe(paste.height);
    expect(button.height).toBe(type.height);
    expect(button.y + button.height).toBeCloseTo(paste.y + paste.height, 0);
    expect(button.y + button.height).toBeCloseTo(type.y + type.height, 0);
    expect(
      await collapse.evaluate((element) => {
        const form = element.closest("form");
        return form?.parentElement?.children.length;
      }),
    ).toBe(1);
    expect(
      await app.locator("body").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  await collapse.click();
  await expect(
    app.getByRole("button", { name: "Expand controls", exact: true }),
  ).toBeVisible();
});

test("reading content bleeds to the bottom while floating controls keep their safe-area inset", async ({
  app,
  workspace,
}) => {
  await app.setViewportSize({ width: 375, height: 812 });
  const session = await history(workspace.directory, "Full-bleed reading", [
    user("A long conversation"),
    assistant([
      { type: "text", text: "A paragraph for reading.\n\n".repeat(60) },
    ]),
  ]);
  await openSession(app, session.id, { reading: true });
  await app.evaluate(() =>
    document.documentElement.style.setProperty("--safe-bottom", "34px"),
  );
  const pane = app.locator(".messages");
  const expand = app.getByRole("button", {
    name: "Expand controls",
    exact: true,
  });
  await expect(app.locator(".app")).toHaveCSS("padding-bottom", "0px");
  const geometry = await pane.evaluate((element) => {
    const body = element.parentElement;
    if (!body) throw new Error("Missing content shell body");
    return {
      bottom: element.getBoundingClientRect().bottom,
      viewport: window.innerHeight,
      mask: getComputedStyle(body).maskImage,
    };
  });
  expect(geometry.bottom).toBe(geometry.viewport);
  expect(geometry.mask).toBe(
    "linear-gradient(rgba(0, 0, 0, 0), rgb(0, 0, 0) 16px)",
  );
  const bounds = await expand.boundingBox();
  if (!bounds) throw new Error("Missing floating controls");
  expect(bounds.y + bounds.height).toBe(geometry.viewport - 34 - 12);
  await pane.evaluate((element) => {
    element.scrollTop = 100;
  });
  expect(await expand.boundingBox()).toEqual(bounds);
  await expand.click();
  await expect(app.locator(".app")).toHaveCSS("padding-bottom", "82px");
});

test("sending returns to reading with an accessible floating Stop action", async ({
  app,
  workspace,
}) => {
  const session = await history(workspace.directory, "Reading after send");
  await openSession(app, session.id);
  const prompt = app.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === `/api/session/${session.id}/prompt` &&
      request.method() === "POST",
  );
  await send(
    app,
    "Count from 1 to 200, spelling out each number on a separate line. Do not use tools.",
    { reading: true },
  );
  const input: unknown = (await prompt).postDataJSON();
  expect(input).toMatchObject({ delivery: "steer" });
  await expect(
    app.getByRole("button", { name: "Expand controls", exact: true }),
  ).toBeVisible();
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeHidden();
  await expect(
    app.getByRole("button", { name: "Stop generating", exact: true }),
  ).toBeVisible();
  await app
    .getByRole("button", { name: "Stop generating", exact: true })
    .click();
  await client.session.wait(
    { sessionID: session.id },
    { signal: AbortSignal.timeout(60_000) },
  );
  await expect(
    app.getByRole("button", { name: "Stop generating", exact: true }),
  ).toBeHidden();
  await expect(
    app.getByRole("button", { name: "Expand controls", exact: true }),
  ).toBeVisible();
  await app
    .getByRole("button", { name: "Expand controls", exact: true })
    .click();
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("");
});

test("reading and composing modes persist across in-app conversation switches", async ({
  app,
  workspace,
}) => {
  const first = await history(workspace.directory, "First mode persistence");
  const second = await history(workspace.directory, "Second mode persistence");
  await openSession(app, first.id);
  await app.locator(".bottom-nav .session-title-btn").click();
  await app
    .getByRole("dialog", { name: "Sessions", exact: true })
    .locator(".picker-item")
    .filter({ has: app.getByText("Second mode persistence", { exact: true }) })
    .getByRole("button")
    .first()
    .click();
  await expect.poll(() => new URL(app.url()).hash).toBe(`#${second.id}`);
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await app
    .getByRole("button", { name: "Return to reading", exact: true })
    .click();
  await swipe(app, app.locator(".messages"), "left");
  await expect.poll(() => new URL(app.url()).hash).toBe(`#${first.id}`);
  await expect(
    app.getByRole("button", { name: "Expand controls", exact: true }),
  ).toBeVisible();
  await expect(app.locator("[data-bottom-nav]")).toBeHidden();
});

test("reading mode reclaims the bottom rows and preserves a multiline draft", async ({
  app,
  workspace,
}, info) => {
  await app.setViewportSize({ width: 375, height: 812 });
  const session = await history(workspace.directory, "Reading mode", [
    user("A long conversation"),
    assistant([
      { type: "text", text: "A paragraph for reading.\n\n".repeat(60) },
    ]),
  ]);
  await openSession(app, session.id, { reading: true });
  const expand = app.getByRole("button", {
    name: "Expand controls",
    exact: true,
  });
  const input = app.getByRole("textbox", { name: "Message", exact: true });
  await expect(input).toBeHidden();
  await expect(app.locator("[data-bottom-nav]")).toBeHidden();
  await expect(
    app.getByRole("combobox", { name: "Model", exact: true }),
  ).toBeHidden();
  const readingClearance = await app
    .locator(".messages")
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingBottom));
  const before = await expand.boundingBox();
  await app.locator(".messages").evaluate((el) => {
    el.scrollTop = 100;
  });
  await expect(expand).toBeVisible();
  expect(await expand.boundingBox()).toEqual(before);
  await expand.click();
  await expect(app.locator("[data-bottom-nav]")).toBeVisible();
  await input.fill("An unfinished thought\nwith a second line\nand a third");
  await expect
    .poll(() =>
      app
        .locator(".messages")
        .evaluate((el) =>
          Number.parseFloat(getComputedStyle(el).paddingBottom),
        ),
    )
    .toBeGreaterThan(readingClearance + 60);
  await app
    .getByRole("button", { name: "Return to reading", exact: true })
    .click();
  await expect(input).toBeHidden();
  await expect(app.getByText("Draft", { exact: true })).toBeVisible();
  await expect(app.locator(".messages")).not.toHaveJSProperty("scrollTop", 0);
  for (const scheme of ["dark", "light"] as const) {
    await app.emulateMedia({ colorScheme: scheme });
    await info.attach(`reading-${scheme}`, {
      body: await app.screenshot(),
      contentType: "image/png",
    });
  }
  await expand.click();
  await expect(input).toHaveValue(
    "An unfinished thought\nwith a second line\nand a third",
  );
});
