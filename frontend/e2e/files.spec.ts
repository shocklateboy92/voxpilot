import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./browser";
import { assistant, history, openSession } from "./data";

test("Markdown files render, follow document links, load images, refresh, and contain focus", async ({
  app,
  workspace,
}, info) => {
  await mkdir(join(workspace.directory, "docs"));
  await writeFile(
    join(workspace.directory, "docs", "README.md"),
    `# File preview

- First item
- Second item

| Name | Value |
| --- | --- |
| Test | Works |

\`\`\`text
${"wide code ".repeat(60)}
\`\`\`

[Next document](next%20page.md#details)

![Local diagram](diagram.svg)
![Remote diagram](https://images.example.invalid/diagram.svg)
`,
  );
  await writeFile(
    join(workspace.directory, "docs", "next page.md"),
    "# Next document\n\n## Details\n\nLinked document content.\n",
  );
  await writeFile(
    join(workspace.directory, "docs", "diagram.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>',
  );
  await app.route("https://images.example.invalid/diagram.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"/>',
    }),
  );
  const session = await history(workspace.directory, "Markdown files", [
    assistant([{ type: "text", text: "[Preview document](docs/README.md)" }]),
  ]);
  await openSession(app, session.id);
  await expect(
    app.getByRole("button", { name: "Open Markdown", exact: true }),
  ).toHaveCount(0);
  const trigger = app.getByRole("link", {
    name: "Preview document",
    exact: true,
  });
  await trigger.click();
  const viewer = app.getByRole("dialog", { name: "Markdown viewer" });
  await expect(
    viewer.getByRole("heading", { name: "File preview", exact: true }),
  ).toBeVisible();
  await expect(viewer.locator("ul")).toHaveCSS("list-style-type", "disc");
  await expect(viewer.locator("table")).toContainText("Works");
  await expect(viewer.getByRole("textbox", { name: "Message" })).toHaveCount(0);
  for (const alt of ["Local diagram", "Remote diagram"]) {
    await expect
      .poll(() =>
        viewer
          .getByAltText(alt)
          .evaluate(
            (element) =>
              element instanceof HTMLImageElement && element.naturalWidth > 0,
          ),
      )
      .toBe(true);
  }
  await expect(viewer.getByAltText("Local diagram")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  const header = await viewer.locator("[data-status-bar]").boundingBox();
  const heading = await viewer
    .getByRole("heading", { name: "File preview", exact: true })
    .boundingBox();
  if (!header || !heading) throw new Error("Missing viewer geometry");
  expect(heading.y).toBeGreaterThanOrEqual(header.y + header.height);
  for (const width of [280, 390, 1100]) {
    await app.setViewportSize({ width, height: 844 });
    expect(
      await viewer.evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expect(
      viewer.getByRole("button", { name: "Close viewer" }),
    ).toBeInViewport();
  }
  await info.attach("markdown-viewer", {
    body: await app.screenshot(),
    contentType: "image/png",
  });
  await viewer
    .getByRole("link", { name: "Next document", exact: true })
    .click();
  await expect(viewer).toContainText("Linked document content.");
  await expect(viewer.locator("#details")).toHaveText("Details");
  await viewer.getByRole("button", { name: "Previous document" }).click();
  await expect(
    viewer.getByRole("heading", { name: "File preview", exact: true }),
  ).toBeVisible();
  await viewer.getByRole("button", { name: "Refresh file" }).click();
  await expect
    .poll(() =>
      viewer
        .getByAltText("Local diagram")
        .evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await writeFile(
    join(workspace.directory, "docs", "README.md"),
    "# Updated preview\n\nFresh contents.\n",
  );
  await viewer.getByRole("button", { name: "Refresh file" }).click();
  await expect(
    viewer.getByRole("heading", { name: "Updated preview" }),
  ).toBeVisible();
  await viewer.getByRole("button", { name: "Close viewer" }).focus();
  await app.keyboard.press("Tab");
  await expect(
    viewer.getByRole("button", { name: "Refresh file" }),
  ).toBeFocused();
  await app.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("Read tool Markdown preview loads the complete file and recovers from missing and empty files", async ({
  app,
  workspace,
}) => {
  const path = join(workspace.directory, "guide #1.md");
  await writeFile(
    path,
    "# Complete document\n\nNot present in the tool excerpt.\n",
  );
  const session = await history(workspace.directory, "Read Markdown", [
    assistant([
      { type: "text", text: "[Missing document](missing.md)" },
      {
        type: "tool",
        id: "read-markdown",
        name: "read",
        time: { created: Date.now(), completed: Date.now() },
        state: {
          status: "completed",
          input: { path, limit: 1 },
          content: [{ type: "text", text: "1: # Complete document" }],
        },
      },
    ]),
  ]);
  await openSession(app, session.id);
  await app.locator(".tool-block summary").click();
  await app.getByRole("button", { name: "View Markdown" }).click();
  const viewer = app.getByRole("dialog", { name: "Markdown viewer" });
  await expect(viewer).toContainText("Not present in the tool excerpt.");
  await viewer.getByRole("button", { name: "Close viewer" }).click();
  await app
    .getByRole("link", { name: "Missing document", exact: true })
    .click();
  await expect(viewer.getByRole("alert")).toBeVisible();
  await writeFile(join(workspace.directory, "missing.md"), "");
  await viewer.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(viewer).toContainText("This file is empty.");
  await writeFile(join(workspace.directory, "missing.md"), "# Recovered\n");
  await viewer.getByRole("button", { name: "Refresh file" }).click();
  await expect(
    viewer.getByRole("heading", { name: "Recovered" }),
  ).toBeVisible();
});
