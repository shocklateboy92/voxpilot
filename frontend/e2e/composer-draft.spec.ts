import { expect, frontendTest as test } from "./fixtures";

test.use({
  launchOptions: {
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
  },
});

test("HTTP non-localhost origins can create image previews without secure-context APIs", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing frontend origin");
  const origin = new URL(baseURL);
  origin.hostname = "voxpilot.test";
  // Proxy this non-localhost HTTP origin to the actual fixture server. This
  // exercises browser security restrictions without depending on LAN IPs/DNS.
  await page.route(`${origin.origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    url.hostname = new URL(baseURL).hostname;
    await route.fulfill({ response: await route.fetch({ url: url.href }) });
  });
  await page.route("**/config.json", (route) => route.fulfill({ status: 404 }));
  await page.goto(origin.href);
  const result = await page.evaluate(async () => {
    const moduleURL = "/src/features/chat/create-composer-draft.ts";
    const {
      composerDraft,
    }: typeof import("../src/features/chat/create-composer-draft") =
      await import(moduleURL);
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zH8AAAAASUVORK5CYII=";
    const file = new File(
      [Uint8Array.from(atob(png), (character) => character.charCodeAt(0))],
      "photo.png",
      { type: "image/png" },
    );
    const draft = composerDraft(undefined);
    draft.addFiles([file, file]);
    const first = draft.attachments()[0];
    if (!first) throw new Error("Image was not added to the draft");
    const image = new Image();
    image.src = first.previewUrl;
    await image.decode();
    const snapshot = draft.snapshot();
    draft.removeAttachment(first.id);
    const remaining = draft.attachments().length;
    const result = {
      secureContext: isSecureContext,
      randomUUID: typeof crypto.randomUUID,
      count: snapshot.attachments.length,
      uniqueIDs: new Set(snapshot.attachments.map((entry) => entry.id)).size,
      remaining,
      width: image.naturalWidth,
      errors: draft.errors(),
    };
    draft.consume(snapshot);
    return result;
  });
  expect(result).toEqual({
    secureContext: false,
    randomUUID: "undefined",
    count: 2,
    uniqueIDs: 2,
    remaining: 1,
    width: 1,
    errors: [],
  });
});

test("draft limits, revisions, transfers, and object-URL cleanup", async ({
  page,
}) => {
  await page.route("**/draft-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<main>Draft fixture</main>",
    }),
  );
  await page.goto("/draft-fixture");
  const result = await page.evaluate(async () => {
    const moduleURL = "/src/features/chat/create-composer-draft.ts";
    const {
      composerDraft,
      moveNewComposerDraft,
      discardComposerDraft,
    }: typeof import("../src/features/chat/create-composer-draft") =
      await import(moduleURL);
    const revoked: string[] = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (value) => {
      revoked.push(value);
      revoke(value);
    };
    const draft = composerDraft(undefined);
    const file = (name: string, size = 1, type = "image/png") =>
      new File([new Uint8Array(size)], name, { type });
    draft.addFiles([
      file("a.png", 10 * 1024 * 1024),
      file("b.png", 10 * 1024 * 1024),
      file("c.png"),
    ]);
    const totalError = draft.errors()[0];
    const admittedCount = draft.attachments().length;
    for (const entry of draft.attachments()) draft.removeAttachment(entry.id);
    draft.addFiles([
      file("empty.png", 0),
      file("large.png", 10 * 1024 * 1024 + 1),
      file("bad.svg", 1, "image/svg+xml"),
    ]);
    const validationErrors = [...draft.errors()];
    draft.addFiles(
      Array.from({ length: 11 }, (_, index) => file(`${index}.png`)),
    );
    const countError = draft.errors()[0];
    const limitedCount = draft.attachments().length;
    draft.setText("submitted");
    const snapshot = draft.snapshot();
    draft.setSending(true);
    draft.addFiles([file("ignored.png")]);
    const countWhileSending = draft.attachments().length;
    moveNewComposerDraft("session");
    const transferred = composerDraft("session") === draft;
    const newChatEmpty = composerDraft(undefined).attachments().length === 0;
    // Same text with a newer revision must not be cleared either.
    draft.setText("submitted");
    draft.consume(snapshot);
    const newerText = draft.text();
    const remaining = draft.attachments().length;
    draft.setSending(false);
    draft.addFiles([file("dispose.png")]);
    discardComposerDraft("session");
    return {
      totalError,
      admittedCount,
      validationErrors,
      countError,
      limitedCount,
      countWhileSending,
      transferred,
      newChatEmpty,
      newerText,
      remaining,
      revokedCount: revoked.length,
      uniqueRevoked: new Set(revoked).size,
    };
  });
  expect(result).toMatchObject({
    admittedCount: 2,
    limitedCount: 10,
    countWhileSending: 10,
    transferred: true,
    newChatEmpty: true,
    newerText: "submitted",
    remaining: 0,
    revokedCount: 13,
    uniqueRevoked: 13,
  });
  expect(result.totalError).toContain("20 MiB");
  expect(result.countError).toContain("10 attachments");
  expect(result.validationErrors).toHaveLength(3);
  expect(result.validationErrors[0]).toContain("empty");
  expect(result.validationErrors[1]).toContain("10 MiB");
  expect(result.validationErrors[2]).toContain(
    "supports PNG, JPEG, WebP, and GIF",
  );
});
