import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VoxPilotRpc } from "../../plugin/src/rpc";
import { expect, test } from "./browser";
import { assistant, history, openSession, swipe } from "./data";
import { client } from "./dev";

test("code review reformats on resize, navigates regions both ways, and reopens its snapshot", async ({
  app,
  workspace,
}) => {
  const path = join(workspace.directory, "review.ts");
  const source = Array.from(
    { length: 45 },
    (_, i) =>
      `export const value${i} = example(11111111, 22222222, 33333333, 44444444);`,
  ).join("\n");
  await writeFile(path, source);
  await workspace.git("add", "review.ts");
  await workspace.git(
    "-c",
    "user.name=E2E",
    "-c",
    "user.email=e2e@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "review code",
  );
  const after = source
    .replace("value2 =", "changed2 =")
    .replace("value35 =", "changed35 =");
  await writeFile(path, after);
  const snapshot = await client
    .rpc(VoxPilotRpc)
    .compare({ workdir: workspace.directory });
  const session = await history(workspace.directory, "Review navigation", [
    assistant([
      {
        type: "tool",
        id: "review-tool",
        name: "voxpilot_show_diff",
        time: { created: Date.now(), completed: Date.now() },
        state: {
          status: "completed",
          input: { workdir: workspace.directory },
          content: [
            {
              type: "text",
              text: `Diff HEAD → WORKTREE\n[ref:${snapshot.id}]`,
            },
          ],
        },
      },
    ]),
  ]);
  await openSession(app, session.id);
  await app.locator(".changeset-file-row", { hasText: "review.ts" }).click();
  const review = app.getByRole("dialog", { name: "File review" });
  await expect(review.locator(".change-region")).toHaveCount(2);
  await expect(review.locator(".current-change").first()).toContainText(
    "changed2",
  );
  await review.press("PageDown");
  await expect(review.locator(".current-change").first()).toContainText(
    "changed35",
  );
  await review.press("PageUp");
  await expect(review.locator(".current-change").first()).toContainText(
    "changed2",
  );
  if (!process.env.VOXPILOT_E2E_CDP) {
    await swipe(app, review.locator(".review-diff-container"), "left");
    await expect(review.locator(".current-change").first()).toContainText(
      "changed35",
    );
    await swipe(app, review.locator(".review-diff-container"), "right");
    await expect(review.locator(".current-change").first()).toContainText(
      "changed2",
    );
  }

  const narrowLines = await review.locator(".fulltext-line").count();
  const format = app.waitForResponse(
    (response) => response.url().endsWith("/formatComparison") && response.ok(),
  );
  await app.setViewportSize({ width: 1100, height: 900 });
  await format;
  await expect
    .poll(() => review.locator(".fulltext-line").count())
    .toBeLessThan(narrowLines);
  expect(await readFile(path, "utf8")).toBe(after);
  await writeFile(path, "// changed after snapshot capture\n");
  await review.getByRole("button", { name: "Close review" }).click();
  await app.reload({ waitUntil: "domcontentloaded" });
  await app.locator(".changeset-file-row", { hasText: "review.ts" }).click();
  await expect(review).toContainText("changed35");
  await expect(review).not.toContainText("changed after snapshot capture");
  await expect(review.locator(".current-change").first()).toContainText(
    "changed2",
  );
  await review.press("PageDown");
  await expect(review.locator(".current-change").first()).toContainText(
    "changed35",
  );
  await review.press("PageDown");
  await expect(review.locator(".review-file-path")).toContainText("sample.txt");
  await review.press("PageUp");
  await expect(review.locator(".review-file-path")).toContainText("review.ts");
  await expect(review.locator(".current-change").first()).toContainText(
    "changed35",
  );
  await review.press("Escape");
  await expect(review).toHaveCount(0);
  expect(await readFile(path, "utf8")).toBe(
    "// changed after snapshot capture\n",
  );
});

test("review comparison modes select merge-base changes, exclude uncommitted files, and recover from invalid refs", async ({
  app,
  workspace,
}) => {
  await workspace.git("checkout", "-b", "feature");
  await writeFile(
    join(workspace.directory, "feature.ts"),
    "export const feature = true;\n",
  );
  await workspace.git("add", "feature.ts");
  await workspace.git(
    "-c",
    "user.name=E2E",
    "-c",
    "user.email=e2e@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "feature",
  );
  const session = await history(workspace.directory, "Branch review");
  await openSession(app, session.id);
  await app
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const picker = app.getByRole("dialog", {
    name: "Review changes",
    exact: true,
  });
  await picker.getByLabel("Comparison").selectOption("branch");
  await picker.getByLabel("Base branch").fill("main");
  await picker.getByRole("button", { name: "Load changes" }).click();
  await expect(picker.locator(".changeset-file-row")).toHaveCount(3);
  await picker.getByLabel("Comparison").selectOption("committed");
  await picker.getByRole("button", { name: "Load changes" }).click();
  await expect(picker.locator(".changeset-file-row")).toHaveCount(1);
  await expect(picker.locator(".changeset-file-row")).toContainText(
    "feature.ts",
  );
  await picker.getByLabel("Base branch").fill("missing-e2e-ref");
  await picker.getByRole("button", { name: "Load changes" }).click();
  await expect(app.getByRole("alert")).toBeVisible();
  await expect(
    picker.getByRole("button", { name: "Load changes" }),
  ).toBeEnabled();
  await picker.getByLabel("Base branch").fill("HEAD");
  await picker.getByRole("button", { name: "Load changes" }).click();
  await expect(picker).toContainText("No changes.");
});

test("missing review snapshots explain recovery rather than showing an empty successful card", async ({
  app,
  workspace,
}) => {
  const session = await history(workspace.directory, "Missing snapshot", [
    assistant([
      {
        type: "tool",
        id: "missing-review",
        name: "voxpilot_show_diff",
        time: { created: Date.now(), completed: Date.now() },
        state: {
          status: "completed",
          input: { workdir: workspace.directory },
          content: [
            {
              type: "text",
              text: "[ref:00000000-0000-0000-0000-000000000000]",
            },
          ],
        },
      },
    ]),
  ]);
  await openSession(app, session.id);
  await expect(app.locator(".changeset-card")).toContainText(
    "Review snapshot not found. Open a new comparison.",
  );
});
