import type { Route } from "@playwright/test";
import { expect, idle, test } from "./browser";
import { history, openSession, selectSession, user } from "./data";
import { client } from "./dev";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC";
const image = {
  name: "red.png",
  mimeType: "image/png",
  buffer: Buffer.from(png, "base64"),
};

test("native prompts normalize inline files without a custom upload endpoint", async ({
  workspace,
}) => {
  const session = await history(
    workspace.directory,
    "Native attachment admission",
  );
  const admitted = await client.session.prompt({
    sessionID: session.id,
    text: "",
    files: [{ uri: `data:image/png;base64,${png}`, name: image.name }],
    resume: false,
  });
  expect(admitted.payload.files).toMatchObject([
    { name: "red.png", mime: "image/png", data: png },
  ]);
});

test("images send in new and existing chats, including image-only messages, and survive reload", async ({
  app,
}) => {
  test.setTimeout(120_000);
  await app.getByLabel("Attach images", { exact: true }).setInputFiles(image);
  await expect(
    app.getByRole("button", { name: "Preview red.png", exact: true }),
  ).toBeVisible();
  await app
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("What color is this image? Reply with just the color name.");
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    app.getByRole("button", { name: "View red.png", exact: true }),
  ).toBeVisible();
  await idle(app);
  await expect(app.locator(".message.assistant")).toContainText(/red/i);
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("");
  await expect(
    app.getByRole("list", { name: "Attachments", exact: true }),
  ).toHaveCount(0);

  await app
    .getByLabel("Attach images", { exact: true })
    .setInputFiles({ ...image, name: "second.png" });
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    app.getByRole("button", { name: "View second.png", exact: true }),
  ).toBeVisible();
  await idle(app);
  const sessionID = new URL(app.url()).hash.slice(1);
  const messages = (
    await client.message.list({ sessionID, limit: 100, order: "asc" })
  ).data;
  const users = messages.filter((message) => message.type === "user");
  expect(users).toHaveLength(2);
  expect(users.at(-1)).toMatchObject({
    text: "",
    files: [{ name: "second.png", data: png, mime: "image/png" }],
  });
  for (const message of messages) {
    if (message.type === "assistant") expect(message.error).toBeUndefined();
  }
  await app.reload();
  await expect(
    app.getByRole("button", { name: "View red.png", exact: true }),
  ).toBeVisible();
  await app
    .getByRole("button", { name: "View second.png", exact: true })
    .click();
  const preview = app.getByRole("dialog", {
    name: "Image preview",
    exact: true,
  });
  await expect(
    preview.getByRole("img", { name: "second.png", exact: true }),
  ).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(
    app.getByRole("button", { name: "View second.png", exact: true }),
  ).toBeFocused();
});

test("picker validation is explicit and attachments stay usable at narrow widths", async ({
  app,
}, info) => {
  const picker = app.getByLabel("Attach images", { exact: true });
  await picker.setInputFiles([
    image,
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    {
      name: "large.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    },
  ]);
  await expect(
    app.getByText(
      "notes.txt: VoxPilot currently supports PNG, JPEG, WebP, and GIF images only.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    app.getByText("large.png: VoxPilot’s limit is 10 MiB per file.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [280, 390]) {
    await app.setViewportSize({ width, height: 844 });
    await expect(
      app.getByRole("button", { name: "Remove red.png", exact: true }),
    ).toBeInViewport();
    expect(
      await app.locator("body").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  for (const colorScheme of ["dark", "light"] as const) {
    await app.emulateMedia({ colorScheme });
    await info.attach(`attachments-${colorScheme}`, {
      body: await app.screenshot(),
      contentType: "image/png",
    });
  }
  const trigger = app.getByRole("button", {
    name: "Preview red.png",
    exact: true,
  });
  await trigger.click();
  await expect(
    app.getByRole("dialog", { name: "Image preview", exact: true }),
  ).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await app
    .getByRole("button", { name: "Remove red.png", exact: true })
    .click();
  await expect(trigger).toHaveCount(0);
  await picker.setInputFiles(image);
  await expect(trigger).toBeVisible();
});

test("paste and file drop share attachment handling without intercepting text drags", async ({
  app,
}) => {
  await app
    .getByRole("textbox", { name: "Message", exact: true })
    .evaluate((element, base64) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(
        new File(
          [
            Uint8Array.from(atob(base64), (character) =>
              character.charCodeAt(0),
            ),
          ],
          "pasted.png",
          { type: "image/png" },
        ),
      );
      clipboardData.setData("text/plain", "Image caption");
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, png);
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Image caption");
  await expect(
    app.getByRole("button", { name: "Preview pasted.png", exact: true }),
  ).toBeVisible();
  const results = await app.locator("main.app").evaluate((element, base64) => {
    const text = new DataTransfer();
    text.setData("text/plain", "ordinary text");
    const textEvent = new DragEvent("dragover", {
      dataTransfer: text,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(textEvent);
    const files = new DataTransfer();
    files.items.add(
      new File(
        [Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))],
        "dropped.png",
        { type: "image/png" },
      ),
    );
    const enter = new DragEvent("dragenter", {
      dataTransfer: files,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(enter);
    return {
      textPrevented: textEvent.defaultPrevented,
      filePrevented: enter.defaultPrevented,
    };
  }, png);
  expect(results).toEqual({ textPrevented: false, filePrevented: true });
  await expect(
    app.getByText("Drop images to attach", { exact: true }),
  ).toBeVisible();
  await app.locator("main.app").evaluate((element, base64) => {
    const files = new DataTransfer();
    files.items.add(
      new File(
        [Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))],
        "dropped.png",
        { type: "image/png" },
      ),
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: files,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(
    app.getByText("Drop images to attach", { exact: true }),
  ).toHaveCount(0);
  await expect(
    app.getByRole("button", { name: "Preview dropped.png", exact: true }),
  ).toBeVisible();
});

test("failed first-message admission transfers the intact draft into the created session for retry", async ({
  app,
}) => {
  const reject = (route: Route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Attachment admission failed" }),
    });
  await app.route("**/api/session/*/prompt", reject);
  await app.getByLabel("Attach images", { exact: true }).setInputFiles(image);
  await app
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("What color is this image? Reply with just the color name.");
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => new URL(app.url()).hash).not.toBe("");
  await expect(
    app.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("What color is this image? Reply with just the color name.");
  await expect(
    app.getByRole("button", { name: "Preview red.png", exact: true }),
  ).toBeVisible();
  const sessionID = new URL(app.url()).hash.slice(1);
  await app.unroute("**/api/session/*/prompt", reject);
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    app.getByRole("button", { name: "View red.png", exact: true }),
  ).toBeVisible();
  expect(new URL(app.url()).hash).toBe(`#${sessionID}`);
  await idle(app);
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("");
});

test("drafts are isolated across in-app session switches and newer typing survives admission", async ({
  app,
  workspace,
}) => {
  const first = await history(workspace.directory, "First draft");
  await history(workspace.directory, "Second draft");
  await openSession(app, first.id);
  await app.getByLabel("Attach images", { exact: true }).setInputFiles(image);
  await app
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("What color is this image? Reply with just the color name.");
  await selectSession(app, "Second draft");
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("");
  await expect(
    app.getByRole("button", { name: "Preview red.png", exact: true }),
  ).toHaveCount(0);
  await selectSession(app, "First draft");
  await expect(
    app.getByRole("button", { name: "Preview red.png", exact: true }),
  ).toBeVisible();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await app.route("**/api/session/*/prompt", async (route) => {
    await held;
    await route.fallback();
  });
  const request = app.waitForRequest("**/api/session/*/prompt");
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await request;
  await app
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("My next message");
  release();
  await expect(
    app.getByRole("button", { name: "View red.png", exact: true }),
  ).toBeVisible();
  await expect(
    app.getByRole("button", { name: "Preview red.png", exact: true }),
  ).toHaveCount(0);
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("My next message");
  await idle(app);
});

test("saved attachment-only messages render safely, including non-image file cards", async ({
  app,
  workspace,
}) => {
  const message = user("");
  message.files = [
    {
      data: png,
      mime: "image/png",
      name: "saved.png",
      source: { type: "inline" },
    },
    {
      data: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      ).toString("base64"),
      mime: "image/svg+xml",
      name: "unsafe.svg",
      source: { type: "inline" },
    },
  ];
  const session = await history(workspace.directory, "Attachment history", [
    message,
  ]);
  await openSession(app, session.id);
  await expect(app.locator(".message.user")).toHaveCount(1);
  const saved = app.getByRole("button", {
    name: "View saved.png",
    exact: true,
  });
  await expect(saved).toBeVisible();
  expect(
    await saved
      .locator("img")
      .evaluate((element) =>
        element instanceof HTMLImageElement ? element.naturalWidth : 0,
      ),
  ).toBe(64);
  await expect(
    app.getByRole("link", { name: "unsafe.svg", exact: true }),
  ).toHaveAttribute("download", "unsafe.svg");
  expect(
    await app
      .getByRole("link", { name: "unsafe.svg", exact: true })
      .evaluate(async (element) => {
        if (!(element instanceof HTMLAnchorElement))
          throw new Error("Missing download link");
        return (await fetch(element.href)).headers.get("content-type");
      }),
  ).toBe("application/octet-stream");
  await expect(
    app.locator(
      ".message.user svg[onload], .message.user iframe, .message.user object",
    ),
  ).toHaveCount(0);
});

test("model warnings use native capabilities and remain advisory", async ({
  app,
}) => {
  const catalog = await client.model.list();
  await app.route("**/api/model", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...catalog,
        data: catalog.data.map((model) => ({
          ...model,
          capabilities: { ...model.capabilities, input: ["text"] },
        })),
      }),
    }),
  );
  await app.reload();
  await app.getByLabel("Attach images", { exact: true }).setInputFiles(image);
  await expect(
    app.getByText(
      "OpenCode does not list image input for this model. The provider may reject this message.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    app.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await app
    .getByRole("button", { name: "Remove red.png", exact: true })
    .click();
  await expect(app.getByText(/OpenCode does not list image input/)).toHaveCount(
    0,
  );
});

test("session creation failure leaves the new-chat draft intact", async ({
  app,
}) => {
  await app.route("**/api/session", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Session creation failed" }),
    });
  });
  await app.getByLabel("Attach images", { exact: true }).setInputFiles(image);
  await app
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Keep this draft");
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    app.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await expect(
    app.getByRole("heading", { name: "New Chat", exact: true }),
  ).toBeVisible();
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Keep this draft");
  await expect(
    app.getByRole("button", { name: "Preview red.png", exact: true }),
  ).toBeVisible();
});

test("switching chats during image preparation preserves the destination and its agent/model", async ({
  app,
  workspace,
}) => {
  const first = await history(workspace.directory, "Preparing an image");
  const second = await history(workspace.directory, "Other conversation");
  await openSession(app, first.id);
  await app.evaluate(() => {
    const pending: Array<() => void> = [];
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) {
      pending.push(() => read.call(this, blob));
    };
    Object.defineProperty(window, "pendingImageReads", {
      get: () => pending.length,
    });
    window.addEventListener(
      "e2e-resume-image-reads",
      () => {
        FileReader.prototype.readAsDataURL = read;
        for (const resume of pending) resume();
      },
      { once: true },
    );
  });
  await app.getByLabel("Attach images", { exact: true }).setInputFiles(image);
  await app
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("What color is this image? Reply with just the color name.");
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() => app.evaluate(() => Reflect.get(window, "pendingImageReads")))
    .toBe(1);
  await selectSession(app, "Other conversation");
  await app.getByRole("button", { name: "Plan", exact: true }).click();
  await app
    .getByRole("combobox", { name: "Thinking level", exact: true })
    .selectOption("low");
  await app
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Unrelated second draft");
  await app.evaluate(() =>
    window.dispatchEvent(new Event("e2e-resume-image-reads")),
  );
  await expect
    .poll(async () =>
      (await client.message.list({ sessionID: first.id })).data.some(
        (message) => message.type === "user" && message.files?.length === 1,
      ),
    )
    .toBe(true);
  const destination = await client.session.get({ sessionID: first.id });
  expect(destination.agent).toBe("build");
  expect(destination.model).toEqual(first.model);
  expect((await client.message.list({ sessionID: second.id })).data).toEqual(
    [],
  );
  await expect(
    app.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Unrelated second draft");
  await selectSession(app, "Preparing an image");
  await expect(
    app.getByRole("button", { name: "View red.png", exact: true }),
  ).toBeVisible();
  await expect(
    app.getByRole("button", { name: "Preview red.png", exact: true }),
  ).toHaveCount(0);
  await idle(app);
});
