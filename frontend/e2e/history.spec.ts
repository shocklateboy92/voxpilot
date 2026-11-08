import { expect, expectPersistedResponse, idle, send, test } from "./browser";
import {
  assistant,
  history,
  openSession,
  selectSession,
  swipe,
  user,
} from "./data";
import { client, longPrompt, markdownPrompt, modelKey } from "./dev";

test("paginated history loads every turn and forks exactly before a selected turn", async ({
  app,
  workspace,
}) => {
  const messages = Array.from({ length: 110 }, (_, i) => [
    user(`History turn ${i + 1}`),
    assistant([{ type: "text", text: `Reply ${i + 1}` }]),
  ]).flat();
  const session = await history(workspace.directory, "Long history", messages);
  await openSession(app, session.id);
  await expect(app.locator(".message.user")).toHaveCount(110);
  await expect(app.locator(".message.assistant .markdown-body")).toHaveCount(
    110,
  );
  await expect(app.locator(".message.user").first()).toContainText(
    "History turn 1",
  );
  await expect(app.locator(".message.user").last()).toContainText(
    "History turn 110",
  );
  await app
    .getByRole("button", { name: "Fork conversation", exact: true })
    .click();
  await app
    .getByRole("dialog", { name: "Fork conversation", exact: true })
    .getByRole("button", { name: /Turn 3 History turn 3/ })
    .click();
  await expect.poll(() => new URL(app.url()).hash).not.toBe(`#${session.id}`);
  await expect(app.locator(".message.user")).toHaveCount(2);
  await expect(app.locator(".message.user").last()).toContainText(
    "History turn 2",
  );
  const fork = await client.session.get({
    sessionID: new URL(app.url()).hash.slice(1),
  });
  expect(fork.fork?.sessionID).toBe(session.id);
  await selectSession(app, "Long history");
  await expect.poll(() => new URL(app.url()).hash).toBe(`#${session.id}`);
  await expect(app.locator(".message.user")).toHaveCount(110);
});

test("switching sessions during generation isolates transcripts and preserves background progress", async ({
  app,
  workspace,
}) => {
  const other = await history(workspace.directory, "Other conversation", [
    user("Other user"),
    assistant([{ type: "text", text: "Other reply" }]),
  ]);
  await send(app, longPrompt);
  await expect(app.locator(".message.streaming")).toContainText(
    "Streaming baseline chunk",
  );
  const generating = new URL(app.url()).hash.slice(1);
  await client.session.update({
    sessionID: generating,
    title: "Generating conversation",
  });
  await selectSession(app, "Other conversation");
  await expect(app.locator(".message.user")).toHaveText("Other user");
  await expect(app.locator(".markdown-body")).toHaveText("Other reply");
  await idle(app);
  await client.session.wait({ sessionID: generating });
  await expect(app.locator(".markdown-body")).toHaveText("Other reply");
  await selectSession(app, "Generating conversation");
  await expectPersistedResponse(app);
  await expect(app.locator(".message.user")).toHaveText(longPrompt);
  expect(other.id).not.toBe(generating);
});

test("scroll position is restored across session switches and Scroll to bottom resumes following output", async ({
  app,
  workspace,
}) => {
  const first = await history(workspace.directory, "Scrollable conversation", [
    user("Long reply please"),
    assistant([
      {
        type: "text",
        text: Array.from(
          { length: 100 },
          (_, i) => `Paragraph ${i + 1}\n\n`,
        ).join(""),
      },
    ]),
  ]);
  const second = await history(workspace.directory, "Short conversation", [
    assistant([{ type: "text", text: "Short reply" }]),
  ]);
  await openSession(app, first.id);
  const pane = app.locator(".messages-content").locator("..");
  await expect
    .poll(() => pane.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  await pane.evaluate((el) => {
    el.scrollTop = 400;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect(
    app.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();
  const position = await pane.evaluate((el) => el.scrollTop);
  await selectSession(app, "Short conversation");
  await expect(app.locator(".markdown-body")).toHaveText("Short reply");
  await selectSession(app, "Scrollable conversation");
  await expect
    .poll(() =>
      pane.evaluate((el, saved) => Math.abs(el.scrollTop - saved), position),
    )
    .toBeLessThan(5);
  await app.getByRole("button", { name: "Scroll to bottom" }).click();
  await expect
    .poll(() =>
      pane.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(50);
  await expect(
    app.getByRole("button", { name: "Scroll to bottom" }),
  ).toHaveCount(0);
  await selectSession(app, "Short conversation");
  await expect(app.locator(".markdown-body")).toHaveText("Short reply");
  await selectSession(app, "Scrollable conversation");
  await expect
    .poll(() =>
      pane.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(50);
  expect(second.id).not.toBe(first.id);
});

test("touch swipes navigate conversations but horizontal code-block scrolling does not", async ({
  app,
  workspace,
}) => {
  test.skip(
    Boolean(process.env.VOXPILOT_E2E_CDP),
    "Touch input uses isolated Chromium",
  );
  const older = await history(workspace.directory, "Older swipe conversation", [
    assistant([{ type: "text", text: "Older reply" }]),
  ]);
  const newer = await history(workspace.directory, "Newer swipe conversation", [
    assistant([
      { type: "text", text: `\`\`\`text\n${"wide code ".repeat(100)}\n\`\`\`` },
    ]),
  ]);
  await openSession(app, newer.id);
  const code = app.locator(".scroll-wrapper");
  await code.scrollIntoViewIfNeeded();
  await swipe(app, code, "left");
  await expect
    .poll(() => code.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(30);
  await expect.poll(() => new URL(app.url()).hash).toBe(`#${newer.id}`);
  await swipe(app, app.locator(".messages-content").locator(".."), "left");
  await expect.poll(() => new URL(app.url()).hash).toBe(`#${older.id}`);
  await swipe(app, app.locator(".messages-content").locator(".."), "right");
  await expect.poll(() => new URL(app.url()).hash).toBe(`#${newer.id}`);
});

test("tables and other overflow containers scroll horizontally without session swipes", async ({
  app,
  workspace,
}) => {
  test.skip(
    Boolean(process.env.VOXPILOT_E2E_CDP),
    "Touch input uses isolated Chromium",
  );
  await history(workspace.directory, "Older horizontal-scroll conversation", [
    assistant([{ type: "text", text: "Older reply" }]),
  ]);
  const session = await history(
    workspace.directory,
    "Horizontal-scroll boundaries",
    [
      assistant([
        {
          type: "text",
          text: `| Wide column | Other |\n| --- | --- |\n| ${"wide_table_cell".repeat(120)} | Value |`,
        },
        {
          type: "tool",
          id: "wide-read-output",
          name: "read",
          time: { created: Date.now(), completed: Date.now() },
          state: {
            status: "completed",
            input: { path: "wide.txt" },
            content: [{ type: "text", text: "wide tool output ".repeat(120) }],
          },
        },
      ]),
    ],
  );
  await openSession(app, session.id);
  await app.locator(".tool-block summary").click();
  // CodeOutput normally wraps. Use it as an unwrapped overflow fixture to
  // exercise the generic boundary, without a Markdown scroll-wrapper class.
  await app.locator(".tool-block pre").evaluate((element) => {
    element.style.whiteSpace = "pre";
    element.style.wordBreak = "normal";
    element.style.overflowX = "auto";
  });
  for (const scroller of [
    app.locator(".scroll-wrapper"),
    app.locator(".tool-block pre"),
  ]) {
    await scroller.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        scroller.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      )
      .toBeGreaterThan(100);
    await swipe(app, scroller, "left");
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(30);
    expect(new URL(app.url()).hash).toBe(`#${session.id}`);
  }
});

test("keyboard sending, multiline input, and agent/thinking selections reach the native session", async ({
  app,
}) => {
  await app.getByRole("button", { name: "Plan", exact: true }).click();
  await app
    .getByRole("combobox", { name: "Thinking level", exact: true })
    .selectOption("low");
  const input = app.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("Reply exactly KEYBOARD_OK. Do not use tools.");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue(
    "Reply exactly KEYBOARD_OK. Do not use tools.\n",
  );
  await input.press("Enter");
  await expect(app.locator(".markdown-body").last()).toHaveText("KEYBOARD_OK");
  await idle(app);
  const session = await client.session.get({
    sessionID: new URL(app.url()).hash.slice(1),
  });
  expect(session.agent).toBe("plan");
  expect(session.model).toMatchObject({
    providerID: "github-copilot",
    id: "gpt-6-luna",
    variant: "low",
  });
  await app.getByRole("button", { name: "Build", exact: true }).click();
  await app
    .getByRole("combobox", { name: "Thinking level", exact: true })
    .selectOption("none");
  await send(app, markdownPrompt);
  await idle(app);
  expect((await client.session.get({ sessionID: session.id })).agent).toBe(
    "build",
  );
  await app.reload();
  await expect(
    app.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue(modelKey);
  await expect(
    app.getByRole("combobox", { name: "Thinking level", exact: true }),
  ).toHaveValue("none");
});

test("streaming follows the bottom but does not pull a reader away from older messages", async ({
  app,
  workspace,
}) => {
  const session = await history(
    workspace.directory,
    "Reading while streaming",
    [
      user("Prior request"),
      assistant([
        {
          type: "text",
          text: Array.from(
            { length: 60 },
            (_, i) => `Earlier paragraph ${i + 1}\n\n`,
          ).join(""),
        },
      ]),
    ],
  );
  await openSession(app, session.id);
  await send(app, longPrompt);
  await expect(app.locator(".message.streaming")).toContainText(
    "Streaming baseline chunk",
  );
  const pane = app.locator(".messages-content").locator("..");
  await pane.evaluate((el) => {
    el.scrollTop = 300;
    el.dispatchEvent(new Event("scroll"));
  });
  const position = await pane.evaluate((el) => el.scrollTop);
  await expect(
    app.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();
  await client.session.wait({ sessionID: session.id });
  await idle(app);
  await expect
    .poll(() =>
      pane.evaluate((el, saved) => Math.abs(el.scrollTop - saved), position),
    )
    .toBeLessThan(5);
  await app.getByRole("button", { name: "Scroll to bottom" }).click();
  await expect
    .poll(() =>
      pane.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(50);
});

test("the session picker includes sessions beyond the first server page and switches to an older one", async ({
  app,
  workspace,
}) => {
  for (let start = 0; start < 105; start += 15) {
    await Promise.all(
      Array.from({ length: Math.min(15, 105 - start) }, (_, offset) =>
        history(workspace.directory, `Picker history ${start + offset + 1}`),
      ),
    );
  }
  await app.reload();
  await app.locator(".bottom-nav .session-title-btn").click();
  const picker = app.getByRole("dialog", { name: "Sessions", exact: true });
  const first = picker.getByText("Picker history 1", { exact: true });
  await expect(first).toBeVisible();
  await first.click();
  const session = await client.session.get({
    sessionID: new URL(app.url()).hash.slice(1),
  });
  expect(session.title).toBe("Picker history 1");
  expect(session.projectID).toBe(workspace.projectID);
});
