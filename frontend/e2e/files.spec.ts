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
  await expect(viewer.getByRole("textbox", { name: "Message" })).toBeVisible();
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
    viewer.getByRole("button", { name: "Attach files" }),
  ).toBeFocused();
  await app.keyboard.press("Tab");
  await expect(viewer.getByRole("textbox", { name: "Message" })).toBeFocused();
  await app.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("Markdown file side insets match chat without padding the generic file pane", async ({
  app,
  workspace,
}) => {
  await writeFile(
    join(workspace.directory, "README.md"),
    "# File document\n\nRendered file contents.\n",
  );
  const session = await history(workspace.directory, "Markdown file insets", [
    assistant([
      { type: "text", text: "[Preview](README.md)\n\n[Code](source.ts#L1)" },
    ]),
  ]);
  await openSession(app, session.id);
  const viewer = app.getByRole("dialog", { name: "Markdown viewer" });
  for (const width of [280, 390, 1100, 1440]) {
    await app.setViewportSize({ width, height: 844 });
    const chat = await app
      .locator(".message.assistant .markdown-body")
      .boundingBox();
    if (!chat) throw new Error("Missing chat Markdown geometry");
    await app.getByRole("link", { name: "Preview", exact: true }).click();
    await expect(
      viewer.getByRole("heading", { name: "File document" }),
    ).toBeVisible();
    const file = await viewer.locator(".markdown-body").boundingBox();
    if (!file) throw new Error("Missing file Markdown geometry");
    expect(file.x).toBeCloseTo(chat.x, 0);
    expect(file.width).toBeCloseTo(chat.width, 0);
    await expect(viewer.locator(".markdown-pane")).toHaveCSS(
      "padding-left",
      "0px",
    );
    await expect(viewer.locator(".markdown-pane")).toHaveCSS(
      "padding-right",
      "0px",
    );
    await viewer.getByRole("button", { name: "Close viewer" }).click();
    await expect(viewer).toHaveCount(0);
  }
  await app.getByRole("link", { name: "Code", exact: true }).click();
  await expect(viewer.getByRole("alert")).toContainText("Markdown files only");
  await expect(viewer.locator(".markdown-body")).toHaveCount(0);
  await expect(viewer.locator(".markdown-pane")).toHaveCSS(
    "padding-left",
    "0px",
  );
  await expect(viewer.locator(".markdown-pane")).toHaveCSS(
    "padding-right",
    "0px",
  );
});

test("Markdown composer clearance follows input growth and safe-area insets", async ({
  app,
  workspace,
}) => {
  await writeFile(
    join(workspace.directory, "README.md"),
    `# Long document\n\n${"Body paragraph.\n\n".repeat(80)}Final paragraph.\n`,
  );
  const session = await history(
    workspace.directory,
    "Markdown composer geometry",
    [assistant([{ type: "text", text: "[Preview](README.md)" }])],
  );
  await openSession(app, session.id);
  await app.getByRole("link", { name: "Preview", exact: true }).click();
  const viewer = app.getByRole("dialog", { name: "Markdown viewer" });
  const pane = viewer.locator(".markdown-pane");
  const input = viewer.getByRole("textbox", { name: "Message", exact: true });
  const padding = () =>
    pane.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingBottom),
    );
  await expect.poll(padding).toBeGreaterThan(0);
  const initialPadding = await padding();
  await input.fill(
    Array.from({ length: 12 }, (_, index) => `Composer line ${index}`).join(
      "\n",
    ),
  );
  await expect.poll(padding).toBeGreaterThan(initialPadding);
  for (const inset of [0, 24]) {
    await app.evaluate((value) => {
      document.documentElement.style.setProperty("--safe-bottom", `${value}px`);
    }, inset);
    await input.blur();
    await expect
      .poll(async () => {
        await pane.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const last = await viewer
          .getByText("Final paragraph.", { exact: true })
          .boundingBox();
        const composer = await viewer
          .locator("[data-composer-stack]")
          .boundingBox();
        return last && composer ? composer.y - (last.y + last.height) : -1;
      })
      .toBeGreaterThanOrEqual(15);
  }
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

test("Read tool previews files outside the session with linked documents and images", async ({
  app,
  workspace,
}) => {
  const directory = join(workspace.root, "external docs");
  await mkdir(directory);
  const path = join(directory, "AGENTS.md");
  await writeFile(
    path,
    "# External instructions\n\nFull contents outside the session.\n\n[Next document](next%20%231.md#details)\n\n![External diagram](diagram.svg)\n",
  );
  await writeFile(
    join(directory, "next #1.md"),
    "# Linked external document\n\n## Details\n\nExternal linked contents.\n",
  );
  await writeFile(
    join(directory, "diagram.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"/>',
  );
  const session = await history(workspace.directory, "External Read Markdown", [
    assistant([
      {
        type: "tool",
        id: "read-external-markdown",
        name: "read",
        time: { created: Date.now(), completed: Date.now() },
        state: {
          status: "completed",
          input: { path, limit: 1 },
          content: [{ type: "text", text: "1: # External instructions" }],
        },
      },
    ]),
  ]);
  await openSession(app, session.id);
  await app.locator(".tool-block summary").click();
  await app.getByRole("button", { name: "View Markdown" }).click();
  const viewer = app.getByRole("dialog", { name: "Markdown viewer" });
  await expect(viewer).toContainText("Full contents outside the session.");
  await expect
    .poll(() =>
      viewer
        .getByAltText("External diagram")
        .evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await viewer
    .getByRole("link", { name: "Next document", exact: true })
    .click();
  await expect(viewer).toContainText("External linked contents.");
  await expect(viewer.locator("#details")).toHaveText("Details");
  expect(new URL(app.url()).hash).toBe(`#${session.id}`);
  expect(new URL(app.url()).searchParams.get("directory")).toBe(
    workspace.directory,
  );
  await app.reload();
  await expect(viewer).toContainText("External linked contents.");
  await viewer.getByRole("button", { name: "Close viewer" }).click();
  await expect(viewer).toHaveCount(0);
  expect(new URL(app.url()).hash).toBe(`#${session.id}`);
});
