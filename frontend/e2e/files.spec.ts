import { mkdir, readFile, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_IMAGE_PREVIEW_BYTES } from "../../plugin/src/file-preview";
import { expect, send, test } from "./browser";
import { assistant, history, openSession } from "./data";
import { password } from "./dev";
import {
  metadata,
  mockSpeechCapabilities,
  result,
  speechURL,
  token,
} from "./voice-test";

test("a recording started while reading a file stays live across pane changes", async ({
  app,
  workspace,
}) => {
  const url = new URL(app.url()).origin;
  await app.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        servers: [{ id: "dev", name: "Dev", url, password }],
        speech: { url: speechURL, token },
      },
    }),
  );
  await mockSpeechCapabilities(app);
  const transcript = "Reply with the single word Notes.";
  await app.route(`${speechURL}/v1/transcriptions`, (route) =>
    route.fulfill({ json: result(metadata(route.request()), transcript) }),
  );
  await app.evaluate(() => localStorage.setItem("voxpilot:serverId", "dev"));
  await writeFile(join(workspace.directory, "notes.md"), "# Notes\n");
  const session = await history(workspace.directory, "Discuss a file", [
    assistant([{ type: "text", text: "[Notes](notes.md)" }]),
  ]);
  await openSession(app, session.id, { reading: true });
  await app.evaluate(() => {
    const audio = new AudioContext();
    const destination = audio.createMediaStreamDestination();
    const tone = audio.createOscillator();
    tone.connect(destination);
    tone.start();
    navigator.mediaDevices.getUserMedia = async () => destination.stream;
  });
  const link = app.getByRole("link", { name: "Notes", exact: true });
  await link.click();
  await app.getByRole("heading", { name: "Notes" }).evaluate((element) => {
    document.getSelection()?.selectAllChildren(element);
  });
  await app.getByRole("button", { name: "Record a message" }).click();
  const finish = app.getByRole("button", { name: "Finish recording" });
  await expect(finish).toBeEnabled();
  await app.getByRole("button", { name: "Close viewer" }).click();
  await expect(finish).toBeEnabled();
  await link.click();
  await expect(finish).toBeEnabled();
  await app.getByRole("button", { name: "Close viewer" }).click();
  await expect(app.getByLabel("Recording status")).not.toHaveText("0:00");
  await finish.click();
  await expect(
    app.getByRole("button", { name: "Preview selection" }),
  ).toBeVisible();
  const message = app.locator(".message.user");
  await expect(message).toHaveCount(1);
  await expect(message).toContainText(transcript);
  await expect(message).toContainText("User was viewing:");
  await expect(message).toContainText("Selected text:");
  await expect(message).toContainText("Notes");
  await expect(
    app.getByRole("button", { name: "Expand controls" }),
  ).toBeVisible();
});

test("selected Markdown can be previewed and removed without losing file context", async ({
  app,
  workspace,
}) => {
  const path = join(workspace.directory, "notes.md");
  await writeFile(path, "# Notes\n\nSelect this passage.\n");
  const session = await history(workspace.directory, "Discuss a selection", [
    assistant([{ type: "text", text: "[Notes](notes.md)" }]),
  ]);
  await openSession(app, session.id, { reading: true });
  await app.getByRole("link", { name: "Notes" }).click();
  await app
    .getByText("Select this passage.", { exact: true })
    .evaluate((element) => {
      document.getSelection()?.selectAllChildren(element);
    });
  const expand = app.getByRole("button", { name: "Expand controls" });
  const bounds = await expand.boundingBox();
  if (!bounds) throw new Error("Missing expand controls");
  await app.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await app.mouse.down();
  // Model a browser clearing the document selection before click/focus.
  await app.evaluate(() => document.getSelection()?.removeAllRanges());
  await app.mouse.up();
  await app.getByRole("button", { name: "Preview selection" }).click();
  const preview = app.getByRole("dialog", { name: "Selected passage" });
  await expect(preview.locator("pre")).toHaveText("Select this passage.");
  await preview.press("Escape");
  await app.getByRole("button", { name: "Remove selection" }).click();
  await send(app, "What am I viewing?", {
    reading: true,
    expectedText:
      /What am I viewing\?.*User was viewing: .*\/notes\.md.*Workspace:/s,
  });
  await expect(app.locator(".message.user")).not.toContainText(
    "Selected text:",
  );
});

test("Markdown files render, follow links, refresh and share the session's reading controls", async ({
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
  const message = app.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("Question about this file");
  await message.evaluate((element) =>
    element.setAttribute("data-original-input", "true"),
  );
  await app.getByRole("button", { name: "Return to reading" }).click();
  await expect(
    app.getByRole("button", { name: "Open Markdown", exact: true }),
  ).toHaveCount(0);
  const trigger = app.getByRole("link", {
    name: "Preview document",
    exact: true,
  });
  await trigger.click();
  const viewer = app.getByRole("region", { name: "Markdown viewer" });
  await expect(
    viewer.getByRole("heading", { name: "File preview", exact: true }),
  ).toBeVisible();
  await expect(viewer.locator("ul")).toHaveCSS("list-style-type", "disc");
  await expect(viewer.locator("table")).toContainText("Works");
  await expect(message).toBeHidden();
  await app.getByRole("button", { name: "Expand controls" }).click();
  await expect(message).toHaveAttribute("data-original-input", "true");
  await expect(message).toHaveValue("Question about this file");
  await app.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: () => Promise.reject(new Error("Permission denied")) },
    });
  });
  const paste = app.getByRole("button", { name: "Paste", exact: true });
  await paste.press("Enter");
  const pasteDialog = app.getByRole("dialog", { name: "Paste an item" });
  await expect(pasteDialog).toBeFocused();
  await app.keyboard.press("Shift+Tab");
  await expect(
    pasteDialog.getByRole("textbox", { name: "Pasted text" }),
  ).toBeFocused();
  await app.keyboard.press("Escape");
  await expect(pasteDialog).toHaveCount(0);
  await expect(paste).toBeFocused();
  await expect(viewer).toBeVisible();
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
  const statusBar = viewer.locator("[data-status-bar]");
  await expect(statusBar).toHaveCSS("height", "32px");
  const header = await statusBar.boundingBox();
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
  await app.setViewportSize({ width: 280, height: 844 });
  await expect(statusBar).toHaveCSS("height", "32px");
  await expect(
    viewer.getByRole("button", { name: "Close viewer" }),
  ).toBeInViewport();
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
  await viewer.getByRole("button", { name: "Close viewer" }).click();
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
  await writeFile(join(workspace.directory, "source.ts"), "const x = 1;\n");
  const session = await history(workspace.directory, "Markdown file insets", [
    assistant([
      { type: "text", text: "[Preview](README.md)\n\n[Code](source.ts#L1)" },
    ]),
  ]);
  await openSession(app, session.id);
  const viewer = app.getByRole("region", { name: "Markdown viewer" });
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
  const codeViewer = app.getByRole("region", { name: "Code viewer" });
  await expect(codeViewer.locator("pre code")).toHaveText("const x = 1;");
  await expect(codeViewer.locator(".markdown-body")).toHaveCount(0);
  await expect(codeViewer.locator(".markdown-pane")).toHaveCSS(
    "padding-left",
    "0px",
  );
  await expect(codeViewer.locator(".markdown-pane")).toHaveCSS(
    "padding-right",
    "0px",
  );
});

test("growing the composer keeps Markdown pinned only if already at the bottom", async ({
  app,
  workspace,
}) => {
  await writeFile(
    join(workspace.directory, "README.md"),
    `# Long document\n\n${"Body paragraph.\n\n".repeat(80)}Final paragraph.\n`,
  );
  const session = await history(workspace.directory, "Read and reply", [
    assistant([{ type: "text", text: "[Preview](README.md)" }]),
  ]);
  await openSession(app, session.id);
  await app.getByRole("link", { name: "Preview", exact: true }).click();
  const viewer = app.getByRole("region", { name: "Markdown viewer" });
  const pane = viewer.locator(".markdown-pane");
  const last = viewer.getByText("Final paragraph.", { exact: true });
  const footer = app.locator("[data-composer-stack]");
  const input = app.getByRole("textbox", { name: "Message", exact: true });
  const padding = () =>
    pane.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).paddingBottom),
    );
  const gap = async () => {
    const [paragraph, composer] = await Promise.all([
      last.boundingBox(),
      footer.boundingBox(),
    ]);
    return paragraph && composer
      ? composer.y - paragraph.y - paragraph.height
      : -1;
  };
  const multiline = Array.from({ length: 12 }, (_, i) => `Line ${i}`).join(
    "\n",
  );

  await expect(last).toBeAttached();
  await input.focus();
  await pane.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(gap).toBeGreaterThanOrEqual(15);
  const initialPadding = await padding();
  await input.fill(multiline);
  await expect.poll(padding).toBeGreaterThan(initialPadding);
  await expect.poll(gap).toBeGreaterThanOrEqual(15);

  await input.clear();
  await expect.poll(padding).toBe(initialPadding);
  const scrollTop = await pane.evaluate((el) => {
    el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
    return el.scrollTop;
  });
  await input.fill(multiline);
  await expect.poll(padding).toBeGreaterThan(initialPadding);
  expect(await pane.evaluate((el) => el.scrollTop)).toBe(scrollTop);
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
  const chatPane = app.locator(".messages");
  const chatPadding = await chatPane.evaluate(
    (element) => getComputedStyle(element).paddingBottom,
  );
  await app.evaluate(() =>
    document.documentElement.style.setProperty("--safe-bottom", "24px"),
  );
  await expect(chatPane).toHaveCSS("padding-bottom", chatPadding);
  await app.getByRole("link", { name: "Preview", exact: true }).click();
  const viewer = app.getByRole("region", { name: "Markdown viewer" });
  const pane = viewer.locator(".markdown-pane");
  const input = app.getByRole("textbox", { name: "Message", exact: true });
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
        const composer = await app
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
  const viewer = app.getByRole("region", { name: "Markdown viewer" });
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

test("code previews format for the viewport without changing files on disk", async ({
  app,
  workspace,
}) => {
  const path = join(workspace.directory, "example.ts");
  const comment =
    "// This prose is long enough to reflow on a phone but fits comfortably on a wide screen.";
  const call =
    'const result=renderExample("first argument", "second argument", "third argument")';
  const source = `${comment}\n${call}\n`;
  await writeFile(path, source);
  await writeFile(
    join(workspace.directory, "binary.dat"),
    Buffer.from([0x61, 0, 0x62]),
  );
  const session = await history(workspace.directory, "Read code", [
    assistant([
      { type: "text", text: "[Code](example.ts) [Binary](binary.dat)" },
      {
        type: "tool",
        id: "read-code",
        name: "read",
        time: { created: Date.now(), completed: Date.now() },
        state: {
          status: "completed",
          input: { path, limit: 1 },
          content: [{ type: "text", text: `1: ${comment}` }],
        },
      },
    ]),
  ]);
  await openSession(app, session.id, { reading: true });
  await app.setViewportSize({ width: 375, height: 812 });
  await app.locator(".tool-block summary").click();
  await app.getByRole("button", { name: "View file", exact: true }).click();
  const viewer = app.getByRole("region", { name: "Code viewer" });
  const code = viewer.locator("pre code");
  await expect
    .poll(() => code.textContent())
    .toMatch(/\n\/\/ .*\nconst result = renderExample\(\n/);
  await expect(code.locator(".diff-syntax").first()).toBeVisible();
  expect(
    await viewer.evaluate((element) => element.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await app.setViewportSize({ width: 1100, height: 844 });
  await expect
    .poll(() => code.textContent())
    .toBe(
      `${comment}\nconst result = renderExample("first argument", "second argument", "third argument");\n`,
    );
  expect(await readFile(path, "utf8")).toBe(source);

  await viewer.getByRole("button", { name: "Close viewer" }).click();
  await app.getByRole("link", { name: "Code", exact: true }).click();
  await expect(code).toContainText("third argument");
  const longValue = "x".repeat(120);
  await writeFile(path, `const updated="${longValue}";\n\nconst next=42;\n`);
  await viewer.getByRole("button", { name: "Refresh file" }).click();
  await expect(code).toContainText("const next = 42;");

  await app.setViewportSize({ width: 639, height: 812 });
  const rows = code.locator("[data-code-line]");
  await expect(rows).toHaveCount(3);
  const blankRow = rows.filter({ hasText: /^$/ });
  const longRow = rows.filter({ hasText: longValue });
  const marker = () =>
    blankRow.evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return { content: style.content, width: style.width };
    });
  await expect.poll(marker).toEqual({ content: '""', width: "2px" });
  const insets = await blankRow.evaluate((row) => {
    const pane = row.closest(".markdown-pane");
    const pre = row.closest("pre");
    if (!pane || !pre) throw new Error("Missing code preview layout");
    const paneBounds = pane.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const left = rowBounds.left - paneBounds.left;
    const padding = parseFloat(getComputedStyle(pre).paddingLeft);
    const dot = getComputedStyle(row, "::before");
    return {
      padding,
      left,
      right: paneBounds.left + pane.clientWidth - rowBounds.right,
      dotCenter: left + parseFloat(dot.left) + parseFloat(dot.width) / 2,
    };
  });
  expect(insets.left).toBeCloseTo(insets.padding, 1);
  expect(insets.right).toBeCloseTo(insets.padding, 1);
  expect(insets.dotCenter).toBeCloseTo(insets.padding / 2, 1);
  expect(
    await longRow.evaluate(
      (row) => row.clientHeight > parseFloat(getComputedStyle(row).lineHeight),
    ),
  ).toBe(true);
  await app.setViewportSize({ width: 640, height: 812 });
  await expect.poll(async () => (await marker()).width).toBe("40px");
  expect((await marker()).content).toMatch(/attr\(data-code-line\)|"\d+"/);
  await viewer.getByRole("button", { name: "Close viewer" }).click();
  await app.getByRole("link", { name: "Binary", exact: true }).click();
  await expect(viewer.getByRole("alert")).toContainText(
    "This file contains binary data.",
  );
});

test("Read tool previews extensionless text without filename allowlisting", async ({
  app,
  workspace,
}) => {
  const path = join(workspace.directory, "custom-config");
  await writeFile(path, "A UTF-8 config with no extension: café\n");
  const session = await history(workspace.directory, "Extensionless text", [
    assistant([
      {
        type: "tool",
        id: "read-extensionless",
        name: "read",
        time: { created: Date.now(), completed: Date.now() },
        state: {
          status: "completed",
          input: { path },
          content: [{ type: "text", text: "A UTF-8 config" }],
        },
      },
    ]),
  ]);
  await openSession(app, session.id);
  await app.locator(".tool-block summary").click();
  await app.getByRole("button", { name: "View file", exact: true }).click();
  await expect(
    app.getByRole("region", { name: "Code viewer" }).locator("pre code"),
  ).toHaveText("A UTF-8 config with no extension: café");
});

test("image previews sniff the type, refresh bytes, and show decode errors", async ({
  app,
  workspace,
}) => {
  const name = "drawing #1";
  const path = join(workspace.directory, name);
  const svg = (width: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30"><rect width="100%" height="100%" fill="red"/></svg>`;
  await writeFile(path, svg(40));
  const session = await history(workspace.directory, "Image previews", [
    assistant([{ type: "text", text: "[Drawing](drawing%20%231)" }]),
  ]);
  await openSession(app, session.id, { reading: true });
  await app.setViewportSize({ width: 375, height: 812 });
  await app.getByRole("link", { name: "Drawing" }).click();
  const viewer = app.getByRole("region", { name: "Image viewer" });
  const image = viewer.getByRole("img", { name });
  const width = () =>
    image.evaluate(
      (img) => img instanceof HTMLImageElement && img.naturalWidth,
    );
  await expect.poll(width).toBe(40);
  const original = await image.getAttribute("src");
  expect(original).toMatch(/^blob:/);
  if (!original) throw new Error("Missing image object URL");

  await writeFile(path, svg(70));
  await viewer.getByRole("button", { name: "Refresh file" }).click();
  await expect.poll(width).toBe(70);
  await expect(image).not.toHaveAttribute("src", original);

  await writeFile(
    path,
    Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010806000000",
      "hex",
    ),
  );
  await viewer.getByRole("button", { name: "Refresh file" }).click();
  await expect(viewer.getByRole("alert")).toHaveText(
    "This browser couldn’t display the image.",
  );

  // An oversized file should never reach the native byte route.
  let downloads = 0;
  await app.route("**/api/fs/read/**", (route) => {
    downloads++;
    return route.continue();
  });
  await truncate(path, MAX_IMAGE_PREVIEW_BYTES + 1);
  await viewer.getByRole("button", { name: "Refresh file" }).click();
  await expect(app.getByRole("alert")).toContainText("maximum 20 MiB");
  expect(downloads).toBe(0);
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
  const viewer = app.getByRole("region", { name: "Markdown viewer" });
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
