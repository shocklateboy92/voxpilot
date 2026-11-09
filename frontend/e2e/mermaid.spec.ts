import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test as unit } from "@playwright/test";
import { renderMarkdown } from "../src/ui/markdown";
import { expect, test } from "./browser";
import { assistant, history, openSession } from "./data";

unit(
  "Mermaid fences preserve escaped fallback source without changing other code",
  () => {
    const html = renderMarkdown(
      '```mermaid\nflowchart LR\nA["<script>alert(1)</script>"] --> B\n```\n\n```js\nconst x = 1;\n```',
    );
    expect(html).toContain('class="scroll-wrapper" data-mermaid');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html.match(/data-mermaid/g)).toHaveLength(1);
    expect(html).toContain(
      '<div class="scroll-wrapper"><pre><code class="language-js">',
    );
  },
);

test("Mermaid renders in chat and files, follows themes, and preserves invalid source", async ({
  app,
  workspace,
}) => {
  const diagram =
    'flowchart LR\nA[Start] --> B[Finish]\nclick A "javascript:alert(1)"';
  await writeFile(
    join(workspace.directory, "diagram.md"),
    `# Diagram\n\n\`\`\`mermaid\n${diagram}\n\`\`\``,
  );
  const session = await history(workspace.directory, "Mermaid diagrams", [
    assistant([
      {
        type: "text",
        text: `[Open diagram](diagram.md)\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\n\`\`\`mermaid\nnot a valid diagram\n\`\`\`\n\n\`\`\`js\nconst ordinary = true;\n\`\`\``,
      },
    ]),
  ]);
  await app.emulateMedia({ colorScheme: "dark" });
  await openSession(app, session.id);
  const block = app.locator(".markdown-body [data-mermaid]").first();
  await expect(block.locator("svg")).toBeVisible();
  await expect(block).toContainText("Start");
  await expect(block).toContainText("Finish");
  await expect(block.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(app.locator("code.language-mermaid")).toHaveText(
    "not a valid diagram\n",
  );
  await expect(app.locator("code.language-js")).toHaveText(
    "const ordinary = true;\n",
  );
  const darkId = await block.locator("svg").getAttribute("id");
  await app.emulateMedia({ colorScheme: "light" });
  await expect(block.locator("svg")).not.toHaveAttribute("id", darkId ?? "");
  await expect(block).toContainText("Start");
  await app.getByRole("link", { name: "Open diagram", exact: true }).click();
  const viewer = app.getByRole("dialog", { name: "Markdown viewer" });
  await expect(viewer.locator("[data-mermaid] svg")).toBeVisible();
  await app.setViewportSize({ width: 360, height: 800 });
  expect(
    await app.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);

  // A file refresh replaces the Markdown DOM; stale async work must not win.
  await writeFile(
    join(workspace.directory, "diagram.md"),
    "```mermaid\nflowchart LR\nX[Updated] --> Y[Result]\n```",
  );
  await viewer.getByRole("button", { name: "Refresh file" }).click();
  await expect(viewer.locator("[data-mermaid] svg")).toContainText("Updated");
  await expect(viewer).not.toContainText("Start");
  await expect(app.locator(".mermaid-render-host")).toHaveCount(0);
});
