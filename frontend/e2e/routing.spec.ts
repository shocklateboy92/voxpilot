import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./browser";
import { assistant, history, openSession, selectSession } from "./data";
import { password } from "./dev";

test("native Markdown links use soft navigation and browser history across documents", async ({
  app,
  workspace,
}) => {
  await writeFile(
    join(workspace.directory, "README.md"),
    "# First document\n\n[Next document](next.md#details)\n",
  );
  await writeFile(
    join(workspace.directory, "next.md"),
    "# Second document\n\n## Details\n\nSecond contents.\n",
  );
  const session = await history(workspace.directory, "Router file history", [
    assistant([{ type: "text", text: "[First document](README.md)" }]),
  ]);
  await openSession(app, session.id);
  await app.evaluate(() => {
    document.documentElement.dataset.routerMarker = "unchanged";
  });
  const trigger = app.getByRole("link", {
    name: "First document",
    exact: true,
  });
  await expect(trigger).toHaveAttribute("link", "");
  await trigger.click();
  const viewer = app.getByRole("dialog", { name: "Markdown viewer" });
  await expect(
    viewer.getByRole("heading", { name: "First document", exact: true }),
  ).toBeVisible();
  await viewer
    .getByRole("link", { name: "Next document", exact: true })
    .click();
  await expect(viewer).toContainText("Second contents.");
  await expect(
    viewer.getByRole("button", { name: "Previous document" }),
  ).toBeVisible();
  await app.goBack();
  await expect(
    viewer.getByRole("heading", { name: "First document", exact: true }),
  ).toBeVisible();
  await app.goBack();
  await expect(viewer).toHaveCount(0);
  expect(new URL(app.url()).searchParams.has("file")).toBe(false);
  await expect(trigger).toBeFocused();
  await app.goForward();
  await expect(
    viewer.getByRole("heading", { name: "First document", exact: true }),
  ).toBeVisible();
  await app.goForward();
  await expect(viewer).toContainText("Second contents.");
  await expect(app.locator("html")).toHaveAttribute(
    "data-router-marker",
    "unchanged",
  );
  await viewer.getByRole("button", { name: "Close viewer" }).click();
  await expect(viewer).toHaveCount(0);
  expect(new URL(app.url()).hash).toBe(`#${session.id}`);
  await app.goForward();
  await expect(
    viewer.getByRole("heading", { name: "First document", exact: true }),
  ).toBeVisible();
  await app.reload();
  await expect(
    viewer.getByRole("heading", { name: "First document", exact: true }),
  ).toBeVisible();
  await viewer.getByRole("button", { name: "Close viewer" }).click();
  await expect(viewer).toHaveCount(0);
});

test("same-document anchor navigation preserves authenticated local images", async ({
  app,
  workspace,
}) => {
  await writeFile(
    join(workspace.directory, "README.md"),
    "# Section\n\n[Section](#section)\n\n![Diagram](diagram.svg)\n",
  );
  await writeFile(
    join(workspace.directory, "diagram.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"/>',
  );
  const session = await history(workspace.directory, "Router anchor images", [
    assistant([{ type: "text", text: "[Preview](README.md#section)" }]),
  ]);
  await openSession(app, session.id);
  await app.getByRole("link", { name: "Preview", exact: true }).click();
  const viewer = app.getByRole("dialog", { name: "Markdown viewer" });
  const image = viewer.getByAltText("Diagram");
  await expect(image).toHaveAttribute("src", /^blob:/);
  for (const depth of [2, 3]) {
    await viewer.getByRole("link", { name: "Section", exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(() => {
          const state: unknown = window.history.state;
          return state && typeof state === "object" && "viewerDepth" in state
            ? state.viewerDepth
            : undefined;
        }),
      )
      .toBe(depth);
    await expect(image).toHaveAttribute("src", /^blob:/);
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
});

test("session selection pushes router history and retains legacy session URLs", async ({
  app,
  workspace,
}) => {
  const first = await history(
    workspace.directory,
    "Router first conversation",
    [assistant([{ type: "text", text: "First conversation contents." }])],
  );
  const second = await history(
    workspace.directory,
    "Router second conversation",
    [assistant([{ type: "text", text: "Second conversation contents." }])],
  );
  await openSession(app, first.id);
  await app.evaluate(() => {
    document.documentElement.dataset.routerMarker = "session";
  });
  await selectSession(app, "Router second conversation");
  await expect(app.locator(".message.assistant")).toContainText(
    "Second conversation contents.",
  );
  expect(new URL(app.url()).hash).toBe(`#${second.id}`);
  await app.goBack();
  await expect(app.locator(".message.assistant")).toContainText(
    "First conversation contents.",
  );
  expect(new URL(app.url()).hash).toBe(`#${first.id}`);
  await app.goForward();
  await expect(app.locator(".message.assistant")).toContainText(
    "Second conversation contents.",
  );
  await expect(app.locator("html")).toHaveAttribute(
    "data-router-marker",
    "session",
  );
  await app.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(
    app.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
  await app.goBack();
  await expect(app.locator(".message.assistant")).toContainText(
    "Second conversation contents.",
  );
});

test("opening a file in a new tab uses the href without inheriting in-app history", async ({
  app,
  workspace,
}) => {
  await writeFile(
    join(workspace.directory, "README.md"),
    "# New tab preview\n",
  );
  const session = await history(workspace.directory, "Router new tab", [
    assistant([{ type: "text", text: "[Preview](README.md)" }]),
  ]);
  await openSession(app, session.id);
  await app
    .context()
    .route("**/config.json", (route) => route.fulfill({ status: 404 }));
  const trigger = app.getByRole("link", { name: "Preview", exact: true });
  const [tab] = await Promise.all([
    app.context().waitForEvent("page"),
    trigger.click({ modifiers: ["Control"] }),
  ]);
  try {
    const preview = tab.getByRole("dialog", { name: "Markdown viewer" });
    const connect = tab.getByRole("button", { name: "Connect", exact: true });
    await expect(preview.or(connect)).toBeVisible();
    if (await connect.isVisible()) {
      await tab.getByLabel("Server password").fill(password);
      await connect.click();
    }
    await expect(
      tab.getByRole("dialog", { name: "Markdown viewer" }),
    ).toContainText("New tab preview");
    await expect(
      app.getByRole("dialog", { name: "Markdown viewer" }),
    ).toHaveCount(0);
    await expect(
      tab.getByRole("button", { name: "Previous document" }),
    ).toHaveCount(0);
    await tab.getByRole("button", { name: "Close viewer" }).click();
    await expect(
      tab.getByRole("dialog", { name: "Markdown viewer" }),
    ).toHaveCount(0);
    expect(new URL(tab.url()).hash).toBe(`#${session.id}`);
  } finally {
    await tab.close();
  }
});
