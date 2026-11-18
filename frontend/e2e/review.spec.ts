import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VoxPilotRpc } from "../../plugin/src/rpc";
import { expect, test } from "./browser";
import { assistant, history, openSession, swipe } from "./data";
import { client } from "./dev";

test("code review reformats on resize, navigates regions both ways, and reopens its snapshot", async ({
  app,
  workspace,
}, info) => {
  const fileName = `review-${"long-file-name-".repeat(7)}details.ts`;
  const path = join(workspace.directory, fileName);
  const source = Array.from(
    { length: 45 },
    (_, i) =>
      `export const value${i} = example(11111111, 22222222, 33333333, 44444444);`,
  ).join("\n");
  await writeFile(path, source);
  await workspace.git("add", fileName);
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
  const chatHeader = await app.locator("[data-status-bar]").boundingBox();
  if (!chatHeader) throw new Error("Missing chat status bar");
  await app.locator(".changeset-file-row", { hasText: fileName }).click();
  const review = app.getByRole("dialog", { name: "File review" });
  await expect(review.locator(".change-region")).toHaveCount(2);
  const trigger = review.getByRole("button", {
    name: "Review status",
    exact: true,
  });
  const details = review.getByRole("region", { name: "Review status details" });
  const close = review.getByRole("button", { name: "Close review" });
  const keyword = review
    .locator(".fulltext-line-add code .diff-syntax", {
      hasText: /^const$/,
    })
    .first();
  const keywordColors = new Set<string>();
  for (const scheme of ["dark", "light"] as const) {
    await app.emulateMedia({ colorScheme: scheme });
    keywordColors.add(
      await keyword.evaluate((token) => getComputedStyle(token).color),
    );
    for (const width of [280, 390, 480]) {
      await app.setViewportSize({ width, height: 844 });
      const header = await review.locator("[data-status-bar]").boundingBox();
      if (!header) throw new Error("Missing review status bar");
      expect(header.height).toBe(chatHeader.height);
      await expect(close).toBeInViewport();
      const closeBounds = await close.boundingBox();
      const triggerBounds = await trigger.boundingBox();
      if (!closeBounds || !triggerBounds)
        throw new Error("Missing review controls geometry");
      expect(closeBounds.width).toBe(32);
      expect(closeBounds.height).toBe(32);
      expect(closeBounds.x + closeBounds.width).toBeLessThanOrEqual(
        triggerBounds.x,
      );
      const pathBounds = await review
        .locator(".review-file-path")
        .boundingBox();
      if (!pathBounds) throw new Error("Missing review file path geometry");
      expect(pathBounds.x - (closeBounds.x + closeBounds.width)).toBe(6);
      expect(await trigger.locator("button").count()).toBe(0);
      expect(
        await review
          .locator(".review-file-path")
          .evaluate((element) => element.scrollWidth > element.clientWidth),
      ).toBe(true);
      const pane = review.locator(".review-pane");
      const before = await pane.boundingBox();
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(details.getByText(fileName, { exact: true })).toBeVisible();
      await expect(details).toContainText(workspace.directory);
      await expect(details).toContainText(
        `${snapshot.resolvedFrom} → ${snapshot.resolvedTo}`,
      );
      await expect(details).toContainText("File 1 of 3 · Change 1 of 2");
      expect(
        await details.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(await pane.boundingBox()).toEqual(before);
      await info.attach(`review-details-${scheme}-${width}`, {
        body: await app.screenshot(),
        contentType: "image/png",
      });
      await trigger.press("Escape");
      await expect(details).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(review).toBeVisible();
    }
  }
  expect(keywordColors.size).toBe(2);
  await app.setViewportSize({ width: 390, height: 844 });
  await trigger.press("Enter");
  await expect(details).toBeVisible();
  await review.locator(".review-diff-container").click();
  await expect(details).toHaveCount(0);
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
  await app.locator(".changeset-file-row", { hasText: fileName }).click();
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
  await trigger.click();
  await expect(details.getByText("sample.txt", { exact: true })).toBeVisible();
  await trigger.press("PageUp");
  await expect(review.locator(".review-file-path")).toContainText(fileName);
  await expect(details.getByText(fileName, { exact: true })).toBeVisible();
  await expect(review.locator(".current-change").first()).toContainText(
    "changed35",
  );
  await expect(details).toContainText("File 1 of 3 · Change 2 of 2");
  await trigger.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(review).toBeVisible();
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
