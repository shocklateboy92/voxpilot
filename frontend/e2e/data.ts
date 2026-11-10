import { randomUUID } from "node:crypto";
import type {
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
} from "@opencode/client";
import { expect, type Locator, type Page } from "@playwright/test";
import { client, model } from "./dev";

export function user(text: string): SessionMessageUser {
  return {
    id: `msg_${randomUUID()}`,
    type: "user",
    time: { created: Date.now() },
    text,
  };
}

export function assistant(
  content: SessionMessageAssistant["content"],
): SessionMessageAssistant {
  return {
    id: `msg_${randomUUID()}`,
    type: "assistant",
    agent: "build",
    model,
    time: { created: Date.now(), completed: Date.now() },
    content,
    finish: "stop",
  };
}

/** Durable native history, not a fake provider or intercepted API response. */
export async function history(
  directory: string,
  title: string,
  messages: SessionMessageInfo[] = [],
) {
  const session = await client.session.create({
    title,
    location: { directory },
    agent: "build",
    model,
  });
  if (messages.length === 0) return session;
  const start = Date.now() - messages.length;
  const chronological = messages.map((message, index) => ({
    ...message,
    id: `msg_${randomUUID()}`,
    time: {
      ...message.time,
      created: start + index,
      ...("completed" in message.time ? { completed: start + index } : {}),
    },
  }));
  const imported = await client.session.import({
    info: { ...session, id: `ses_${randomUUID()}` },
    messages: chronological,
  });
  // Imports resolve their location through the request context, not just info.
  await client.session.move({ sessionID: imported.id, directory });
  await client.session.remove({ sessionID: session.id });
  return client.session.get({ sessionID: imported.id });
}

export async function openSession(page: Page, sessionID: string) {
  // A hash-only navigation can validate against the old page's session list and
  // redirect before session.created arrives. Start a fresh document directly,
  // retaining the context's origin-scoped storage but not the old router state.
  const origin = new URL(page.url()).origin;
  await page.goto("about:blank");
  const eventsReady = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/event" && response.ok(),
  );
  await page.goto(`${origin}/#${sessionID}`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).hash).toBe(`#${sessionID}`);
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await eventsReady;
}

export async function selectSession(page: Page, title: string) {
  await page.locator(".bottom-nav .session-title-btn").click();
  await page
    .getByRole("dialog", { name: "Sessions", exact: true })
    .locator(".picker-item")
    .filter({ has: page.getByText(title, { exact: true }) })
    .getByRole("button")
    .first()
    .click();
}

/** Dispatch through Chromium's input subsystem, not DOM event mocks. */
export async function swipe(
  page: Page,
  target: Locator,
  direction: "left" | "right",
) {
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("Missing swipe target");
  const start = direction === "left" ? 270 : 110;
  const end = direction === "left" ? 110 : 270;
  const y = Math.max(80, Math.min(bounds.y + bounds.height / 2, 500));
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: start, y }],
    });
    for (let step = 1; step <= 5; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: start + ((end - start) * step) / 5, y }],
      });
      // Let the swipe transform reach a frame before committing snap-back.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await cdp.detach();
  }
}
