import { expect, expectPersistedResponse, idle, send, test } from "./browser";
import { openSession } from "./data";
import { client, longPrompt, markdownPrompt, modelKey } from "./dev";

test("renders markdown, persists on reload, forks, and deletes through the UI", async ({
  app,
}) => {
  await send(app, markdownPrompt);
  const response = app.locator(".message.assistant .markdown-body");
  await expect(response).toContainText("Browser baseline passed.");
  await idle(app);
  await expect(response.locator("h1")).toHaveText("Baseline response");
  await expect(response.locator("li")).toHaveText([
    "First item",
    "Second item",
  ]);
  await expect(response.locator("pre code")).toContainText("baseline code");
  const transcript = await response.innerText();
  const original = app.url();
  await app.reload({ waitUntil: "domcontentloaded" });
  await expect(app.locator(".message.user")).toHaveText(markdownPrompt);
  await expect(response).toHaveText(transcript);
  await app.getByTitle("Fork conversation", { exact: true }).click();
  await app
    .getByRole("button", { name: "Fork entire conversation", exact: true })
    .click();
  await expect.poll(() => app.url()).not.toBe(original);
  await expect(app.getByRole("dialog")).toHaveCount(0);
  await expect(response).toHaveText(transcript);
  const forkID = new URL(app.url()).hash.slice(1);
  const originalID = new URL(original).hash.slice(1);
  expect(
    (await client.session.get({ sessionID: forkID })).fork?.sessionID,
  ).toBe(originalID);
  await app.locator(".bottom-nav .session-title-btn").click();
  await app
    .locator(".picker-item.active")
    .getByTitle("Delete", { exact: true })
    .click();
  await expect(app.locator(".picker-item.child.active")).toHaveCount(0);
  await expect(client.session.get({ sessionID: forkID })).rejects.toMatchObject(
    { _tag: "SessionNotFoundError" },
  );
  expect((await client.session.get({ sessionID: originalID })).id).toBe(
    originalID,
  );
  await app.reload({ waitUntil: "domcontentloaded" });
  await openSession(app, originalID);
  await expect(app.locator(".message.assistant .markdown-body")).toHaveText(
    transcript,
  );
});

test("event connection recovers after a temporary network interruption", async ({
  app,
}) => {
  test.skip(
    Boolean(process.env.VOXPILOT_E2E_CDP),
    "Never change network state in the shared browser",
  );
  await send(app, longPrompt);
  await expect(app.locator(".message.streaming")).toContainText(
    "Streaming baseline chunk",
  );
  const context = app.context();
  await context.setOffline(true);
  try {
    await expect
      .poll(() =>
        app.evaluate(() =>
          fetch("/api/info", {
            cache: "no-store",
            signal: AbortSignal.timeout(1000),
          }).then(
            () => false,
            () => true,
          ),
        ),
      )
      .toBe(true);
  } finally {
    await context.setOffline(false);
  }
  await expectPersistedResponse(app);
});

test("cancel stops generation and a subsequent prompt completes", async ({
  app,
}) => {
  await send(app, longPrompt);
  await expect(app.locator(".message.streaming")).toContainText(
    "Streaming baseline chunk",
  );
  await app
    .getByRole("button", { name: "Stop generating", exact: true })
    .click();
  await idle(app);
  await send(app, markdownPrompt);
  await expect(
    app.locator(".message.assistant .markdown-body").last(),
  ).toContainText("Browser baseline passed.");
  await idle(app);
});

test("pending question survives reload and accepting an option resumes execution", async ({
  app,
}) => {
  await send(
    app,
    'Use the question tool now to ask "Select an option" with exactly two options: Alpha (First option) and Beta (Second option), single selection. After I answer, reply exactly "Question answered." Do not use other tools.',
  );
  const question = app.locator(".question-block");
  await expect(question).toContainText("Select an option");
  await app.reload({ waitUntil: "domcontentloaded" });
  await expect(question).toContainText("Select an option");
  await expect(
    question.getByRole("button", { name: "Submit", exact: true }),
  ).toBeDisabled();
  await question.getByRole("button", { name: /Alpha/ }).click();
  await question.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect(
    app.locator(".message.assistant .markdown-body").last(),
  ).toHaveText("Question answered.");
  await idle(app);
});

test("pending permission survives reload and Allow once resumes execution", async ({
  app,
}) => {
  await send(
    app,
    'Use the shell tool to run exactly "printf baseline-permission" in the current working directory. After it finishes, reply exactly "Permission answered." Do not use other tools.',
  );
  const permission = app.locator(".tool-confirm");
  await expect(permission).toContainText("requires approval");
  await app.reload({ waitUntil: "domcontentloaded" });
  await expect(permission).toContainText("requires approval");
  await permission
    .getByRole("button", { name: "Allow once", exact: true })
    .click();
  await expect(permission).toHaveCount(0);
  await expect(
    app.locator(".message.assistant .markdown-body").last(),
  ).toHaveText("Permission answered.");
  await idle(app);
});

test("explicit model selection persists across reload", async ({ app }) => {
  const model = app.locator("select.model-select:not(.model-variant-select)");
  await expect(model.locator(`option[value="${modelKey}"]`)).toHaveCount(1);
  await model.selectOption("");
  await expect(model).toHaveValue("");
  await model.selectOption(modelKey);
  await send(app, markdownPrompt);
  await expect(app.locator(".model-badge")).toContainText("GPT-6 Luna");
  await idle(app);
  await app.reload({ waitUntil: "domcontentloaded" });
  await expect(model).toHaveValue(modelKey);
  await expect(app.locator(".model-badge")).toContainText("GPT-6 Luna");
});

test("reload during generation restores the complete transcript without duplicated text", async ({
  app,
}) => {
  await send(app, longPrompt);
  await expect(app.locator(".message.streaming")).toContainText(
    "Streaming baseline chunk 1.",
  );
  await app.reload({ waitUntil: "domcontentloaded" });
  await expectPersistedResponse(app);
  await expect(app.locator(".message.user")).toHaveCount(1);
});

test("native plugin diff card opens the persisted snapshot", async ({
  app,
}) => {
  await send(
    app,
    'Call voxpilot_show_diff with from HEAD and to WORKTREE for the current working directory, including all files. Then reply exactly "Diff ready." Do not use other tools.',
  );
  const card = app.locator(".changeset-card");
  await expect(card).toContainText("sample.txt");
  await idle(app);
  await card.getByRole("button", { name: /sample.txt/ }).click();
  const review = app.locator(".review-overlay");
  await expect(review).toBeVisible();
  await expect(review.locator(".review-file-path")).toContainText("sample.txt");
  await expect(review.locator(".review-diff-container")).toContainText(
    "new baseline line",
  );
  await expect(review.locator(".fulltext-line-add")).not.toHaveCount(0);
});

test("user opens a working-copy review without an agent tool", async ({
  app,
}) => {
  await send(app, markdownPrompt);
  await idle(app);
  await app.getByTitle("Review changes", { exact: true }).click();
  await app.getByRole("button", { name: "Load changes", exact: true }).click();
  await expect(app.locator(".changeset-card")).toContainText("2 files");
  await app.locator(".changeset-file-row", { hasText: "sample.txt" }).click();
  await expect(app.locator(".review-overlay")).toContainText(
    "new baseline line",
  );
  await expect(app.locator(".review-overlay")).toContainText(
    "old baseline line",
  );
  await expect(app.locator(".review-file-counter")).toHaveText("1/2");
  await app.locator(".review-overlay").press("PageDown");
  await expect(app.locator(".review-file-counter")).toHaveText("2/2");
  await expect(app.locator(".review-file-path")).toContainText("second.txt");
});

test("new worktree hosts a session that survives reload", async ({
  app,
  workspace,
}) => {
  await app
    .getByPlaceholder("Worktree name (optional)")
    .fill(`browser-${Date.now()}`);
  await app.getByRole("button", { name: "New worktree", exact: true }).click();
  const worktree = app.locator(".worktree-section select");
  await expect(worktree).not.toHaveValue("", { timeout: 30_000 });
  const directory = await worktree.inputValue();
  expect(directory.startsWith(`${workspace.root}/worktrees/`)).toBe(true);
  await send(app, markdownPrompt);
  await expect(app.locator(".message.assistant .markdown-body")).toContainText(
    "Browser baseline passed.",
  );
  await idle(app);
  const session = await client.session.get({
    sessionID: new URL(app.url()).hash.slice(1),
  });
  expect(session.location.directory).toBe(directory);
  expect(session.projectID).toBe(workspace.projectID);
  await app.reload({ waitUntil: "domcontentloaded" });
  await expect(app.locator(".message.user")).toHaveText(markdownPrompt);
  await expect(app.locator(".message.assistant .markdown-body")).toContainText(
    "Browser baseline passed.",
  );
});
