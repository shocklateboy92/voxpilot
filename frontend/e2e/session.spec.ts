import { expect, idle, send, test } from "./browser";

// Real-server mutations are opt-in, and never run against a production URL.
test.beforeEach(async ({ baseURL }) => {
  test.skip(
    process.env.VOXPILOT_E2E_FIXTURE !== "1",
    "Requires disposable fixture server",
  );
  if (baseURL === undefined) throw new Error("Missing baseURL");
  const target = new URL(baseURL);
  if (
    target.protocol !== "http:" ||
    target.port !== "13000" ||
    !["sisko.home.lasath.com", "localhost", "127.0.0.1"].includes(
      target.hostname,
    )
  ) {
    throw new Error(
      "Fixture tests require the isolated local server on port 13000",
    );
  }
});

test("streams markdown, persists on reload, forks, and deletes through the UI", async ({
  app,
}) => {
  await send(app, "BASELINE_TEXT");
  await expect(app.locator(".message.streaming .markdown-body")).toContainText(
    /\S/,
  );
  await expect(
    app.getByRole("button", { name: "Stop generating", exact: true }),
  ).toBeVisible();
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
  await expect(app.locator(".message.user")).toHaveText("BASELINE_TEXT");
  await expect(response).toHaveText(transcript);
  await app.getByTitle("Fork conversation", { exact: true }).click();
  await app
    .getByRole("button", { name: "Fork entire conversation", exact: true })
    .click();
  await expect.poll(() => app.url()).not.toBe(original);
  await expect(app.getByRole("dialog")).toHaveCount(0);
  await expect(response).toHaveText(transcript);
  await app.locator(".bottom-nav .session-title-btn").click();
  await app
    .locator(".picker-item.active")
    .getByTitle("Delete", { exact: true })
    .click();
  await expect(app.locator(".picker-item.child")).toHaveCount(0);
});

test("event connection recovers after a temporary network interruption", async ({
  app,
}) => {
  test.skip(
    Boolean(process.env.VOXPILOT_E2E_CDP),
    "Never change network state in the shared browser",
  );
  await send(app, "BASELINE_LONG");
  await expect(app.locator(".message.streaming")).toContainText(
    "Streaming baseline chunk",
  );
  const context = app.context();
  await context.setOffline(true);
  try {
    await expect
      .poll(() =>
        app.evaluate(() =>
          fetch("/api/config?probe=1", {
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
  const response = app.locator(".message.assistant .markdown-body");
  await expect(response).toContainText("Streaming baseline chunk 100.", {
    timeout: 25_000,
  });
  await idle(app);
  const text = await response.innerText();
  for (let index = 1; index <= 100; index += 1) {
    expect(text.split(`Streaming baseline chunk ${index}.`).length - 1).toBe(1);
  }
});

test("cancel stops generation and a subsequent prompt completes", async ({
  app,
}) => {
  await send(app, "BASELINE_LONG");
  await expect(app.locator(".message.streaming")).toContainText(
    "Streaming baseline chunk",
  );
  await app
    .getByRole("button", { name: "Stop generating", exact: true })
    .click();
  await idle(app);
  await send(app, "BASELINE_TEXT");
  await expect(
    app.locator(".message.assistant .markdown-body").last(),
  ).toContainText("Browser baseline passed.");
  await idle(app);
});

test("pending question survives reload and accepting an option resumes execution", async ({
  app,
}) => {
  await send(app, "BASELINE_QUESTION");
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
  await app.getByRole("button", { name: "baseline", exact: true }).click();
  await send(app, "BASELINE_PERMISSION");
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
  await expect(model.locator('option[value="fixture/baseline"]')).toHaveCount(
    1,
  );
  await model.selectOption("fixture/baseline");
  await send(app, "BASELINE_TEXT");
  await expect(app.locator(".model-badge")).toContainText("Baseline");
  await idle(app);
  await app.reload({ waitUntil: "domcontentloaded" });
  await expect(model).toHaveValue("fixture/baseline");
  await expect(app.locator(".model-badge")).toContainText("Baseline");
});

test("reload during generation restores the complete transcript without duplicated text", async ({
  app,
}) => {
  await send(app, "BASELINE_LONG");
  await expect(app.locator(".message.streaming")).toContainText(
    "Streaming baseline chunk 1.",
  );
  await app.reload({ waitUntil: "domcontentloaded" });
  const response = app.locator(".message.assistant .markdown-body");
  await expect(response).toContainText("Streaming baseline chunk 100.", {
    timeout: 25_000,
  });
  await idle(app);
  const text = await response.innerText();
  for (let index = 1; index <= 100; index += 1) {
    expect(text.split(`Streaming baseline chunk ${index}.`).length - 1).toBe(1);
  }
  await expect(app.locator(".message.user")).toHaveCount(1);
});

test("MCP diff card opens the real cached diff", async ({ app }) => {
  await send(app, "BASELINE_DIFF");
  const card = app.locator(".changeset-card");
  await expect(card).toContainText("sample.txt");
  await idle(app);
  await card.getByRole("button", { name: /sample.txt/ }).click();
  const review = app.locator(".review-overlay");
  await expect(review).toBeVisible();
  await expect(review.locator(".review-file-path")).toHaveText("sample.txt");
  await expect(review.locator(".review-diff-container")).toContainText(
    "new baseline line",
  );
  await expect(review.locator(".fulltext-line-add")).not.toHaveCount(0);
});

test("new worktree hosts a session that survives reload", async ({ app }) => {
  await app
    .getByPlaceholder("Worktree name (optional)")
    .fill(`browser-${Date.now()}`);
  await app.getByRole("button", { name: "New worktree", exact: true }).click();
  const worktree = app.locator(".worktree-section select");
  await expect(worktree).not.toHaveValue("", { timeout: 30_000 });
  await send(app, "BASELINE_TEXT");
  await expect(app.locator(".message.assistant .markdown-body")).toContainText(
    "Browser baseline passed.",
  );
  await idle(app);
  await app.reload({ waitUntil: "domcontentloaded" });
  await expect(app.locator(".message.user")).toHaveText("BASELINE_TEXT");
  await expect(app.locator(".message.assistant .markdown-body")).toContainText(
    "Browser baseline passed.",
  );
});
