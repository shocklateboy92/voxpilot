import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test as unit } from "@playwright/test";
import {
  fileRequestFromUrl,
  resolveFileLink,
} from "../src/features/files/file-links";
import { fileReadRequest } from "../src/features/files/file-state";
import { renderMarkdown } from "../src/ui/markdown";
import { expect, test } from "./browser";
import { assistant, history, openSession } from "./data";
import { client, password } from "./dev";

unit(
  "absolute file reads use their own parent without changing viewer context",
  () => {
    const location = { directory: "/work/project" };
    for (const path of [
      "/outside/AGENTS.md",
      "/outside/guide #1%.md",
      "/root.md",
    ]) {
      const request = { path, location, fragment: "details" };
      const separator = path.lastIndexOf("/");
      expect(fileReadRequest(request)).toEqual({
        path: path.slice(separator + 1),
        location: { directory: path.slice(0, separator + 1) },
      });
      expect(request).toEqual({ path, location, fragment: "details" });
    }
    const relative = { path: "docs/guide.md", location };
    expect(fileReadRequest(relative)).toBe(relative);
  },
);

unit(
  "file-link classification preserves web URLs and encodes paths and fragments",
  () => {
    const context = {
      request: { location: { directory: "/work/project #1" }, path: "" },
      serverUrl: "https://api.example.com",
      serverId: "dev",
      appUrl: "https://voxpilot.example.com/?connect=1#ses_example",
      sessionID: "ses_example",
    };
    for (const href of [
      "https://example.com/guide.md",
      "mailto:a@example.com",
      "//cdn.example.com/image.svg",
      "#section",
      "?tab=files",
      "/api/info",
      "vscode://file/a.ts",
    ]) {
      expect(resolveFileLink(href, context)).toBeUndefined();
    }
    const resolved = resolveFileLink("docs/guide%20%231.md#L57-L60", context);
    if (!resolved) throw new Error("Missing resolved file link");
    const url = new URL(resolved);
    expect(url.origin).toBe("https://voxpilot.example.com");
    expect(url.searchParams.get("server")).toBe(context.serverUrl);
    expect(url.searchParams.get("serverId")).toBe("dev");
    expect(url.searchParams.has("connect")).toBe(false);
    expect(url.hash).toBe("#ses_example");
    expect(fileRequestFromUrl(url)).toEqual({
      path: "/work/project #1/docs/guide #1.md",
      location: context.request.location,
      fragment: "L57-L60",
    });
    expect(
      fileRequestFromUrl(
        new URL(
          "https://voxpilot.example.com/?file=relative.md&directory=/work",
        ),
      ),
    ).toBeUndefined();
    const docContext = {
      ...context,
      request: {
        ...context.request,
        path: "/work/project #1/docs/guide #1.md",
      },
    };
    const next = resolveFileLink("../README.md#overview", docContext);
    if (!next) throw new Error("Missing parent-directory link");
    expect(fileRequestFromUrl(new URL(next))?.path).toBe(
      "/work/project #1/README.md",
    );
    expect(resolveFileLink("#overview", docContext)).toBeUndefined();
    expect(
      resolveFileLink("#overview", docContext, { fragments: true }),
    ).toContain("fragment=overview");
    const html = renderMarkdown(
      "[**Guide**](docs/guide.md) and [external](https://example.com).",
      (href) => resolveFileLink(href, context),
    );
    expect(html).toContain("<strong>Guide</strong>");
    expect(html).toContain("file=%2Fwork%2Fproject+%231%2Fdocs%2Fguide.md");
    expect(html).toContain('href="https://example.com"');
  },
);

test("chat file links open scoped previews, preserve anchors, reload, and support copied links", async ({
  app,
  workspace,
}) => {
  await mkdir(join(workspace.directory, "docs"));
  await writeFile(
    join(workspace.directory, "docs", "guide #1.md"),
    "# Preview from chat\n\n## Details\n\nCorrect session directory.\n\n[Next](../README.md#overview)\n\n[Details](#details)\n",
  );
  await writeFile(
    join(workspace.directory, "README.md"),
    "# Overview\n\nParent document.\n",
  );
  const source =
    "[**Guide**](docs/guide%20%231.md#details) and [`project.yml:57`](project.yml#L57). [External](https://example.com/guide.md) [Email](mailto:a@example.com) [Section](#section) [API](/api/info).";
  const session = await history(workspace.directory, "Chat file links", [
    assistant([{ type: "text", text: source }]),
  ]);
  await openSession(app, session.id);
  const guide = app.getByRole("link", { name: "Guide", exact: true });
  const href = await guide.getAttribute("href");
  if (!href) throw new Error("Missing file-viewer URL");
  const url = new URL(href);
  expect(url.searchParams.get("file")).toBe(
    join(workspace.directory, "docs", "guide #1.md"),
  );
  expect(url.searchParams.get("directory")).toBe(workspace.directory);
  expect(url.searchParams.get("fragment")).toBe("details");
  expect(url.hash).toBe(`#${session.id}`);
  await expect(
    app.getByRole("link", { name: "External", exact: true }),
  ).toHaveAttribute("href", "https://example.com/guide.md");
  await expect(
    app.getByRole("link", { name: "Email", exact: true }),
  ).toHaveAttribute("href", "mailto:a@example.com");
  await expect(
    app.getByRole("link", { name: "Section", exact: true }),
  ).toHaveAttribute("href", "#section");
  await expect(
    app.getByRole("link", { name: "API", exact: true }),
  ).toHaveAttribute("href", "/api/info");
  await app.getByRole("link", { name: "Section", exact: true }).click();
  expect(new URL(app.url()).hash).toBe(`#${session.id}`);
  await guide.click();
  const viewer = app.getByRole("dialog", { name: "Markdown viewer" });
  await expect(viewer).toContainText("Correct session directory.");
  expect(new URL(app.url()).searchParams.get("fragment")).toBe("details");
  await app.reload();
  await expect(viewer).toContainText("Correct session directory.");
  await viewer.getByRole("link", { name: "Next", exact: true }).click();
  await expect(viewer).toContainText("Parent document.");
  expect(new URL(app.url()).searchParams.get("file")).toBe(
    join(workspace.directory, "README.md"),
  );
  await viewer.getByRole("button", { name: "Previous document" }).click();
  await expect(viewer).toContainText("Correct session directory.");
  await viewer.getByRole("link", { name: "Details", exact: true }).click();
  await expect.poll(() => new URL(app.url()).hash).toBe(`#${session.id}`);
  await viewer.getByRole("button", { name: "Close viewer" }).click();
  expect(new URL(app.url()).searchParams.has("file")).toBe(false);
  await app.getByRole("link", { name: "project.yml:57", exact: true }).click();
  await expect(viewer).toContainText(
    "This viewer currently supports Markdown files only.",
  );
  expect(new URL(app.url()).searchParams.get("fragment")).toBe("L57");
  await viewer.getByRole("button", { name: "Close viewer" }).click();

  // A fresh tab has no tab-scoped password; signing in must retain the file route.
  const tab = await app.context().newPage();
  try {
    await tab.route("**/config.json", (route) =>
      route.fulfill({ status: 404 }),
    );
    await tab.goto(href);
    await expect(
      tab.getByRole("button", { name: "Connect", exact: true }),
    ).toBeVisible();
    await expect(tab.getByLabel("Server URL")).toHaveValue(
      url.searchParams.get("server") ?? "",
    );
    await tab.getByLabel("Server password").fill(password);
    await tab.getByRole("button", { name: "Connect", exact: true }).click();
    await expect
      .poll(() => new URL(tab.url()).searchParams.get("file"))
      .toBe(join(workspace.directory, "docs", "guide #1.md"));
    await expect.poll(() => new URL(tab.url()).hash).toBe(`#${session.id}`);
    await expect(
      tab.getByRole("dialog", { name: "Markdown viewer" }),
    ).toContainText("Correct session directory.");
    expect(new URL(tab.url()).hash).toBe(`#${session.id}`);
  } finally {
    await tab.close();
  }
  const messages = await client.message.list({ sessionID: session.id });
  expect(
    messages.data.some(
      (message) =>
        message.type === "assistant" &&
        message.content.some(
          (part) => part.type === "text" && part.text === source,
        ),
    ),
  ).toBe(true);
});

test("configured file URLs select the named backend instead of the previously selected host", async ({
  app,
  workspace,
}) => {
  await writeFile(
    join(workspace.directory, "README.md"),
    "# Configured file route\n",
  );
  const session = await history(workspace.directory, "Configured file links", [
    assistant([{ type: "text", text: "[Readme](README.md)" }]),
  ]);
  const origin = new URL(app.url()).origin;
  await app.unroute("**/config.json");
  await app.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        servers: [
          {
            id: "wrong",
            name: "Wrong host",
            url: "https://unused.example.invalid",
            password: "must-not-be-used",
          },
          { id: "correct", name: "Correct host", url: origin, password },
        ],
      },
    }),
  );
  await app.evaluate(() => {
    localStorage.setItem("voxpilot:serverId", "wrong");
  });
  const url = new URL(origin);
  url.searchParams.set("server", origin);
  url.searchParams.set("serverId", "correct");
  url.searchParams.set("directory", workspace.directory);
  url.searchParams.set("file", join(workspace.directory, "README.md"));
  url.hash = session.id;
  await app.goto(url.href);
  await expect(
    app.getByRole("dialog", { name: "Markdown viewer" }),
  ).toContainText("Configured file route");
});
