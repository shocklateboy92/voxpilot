import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, idle, send, test } from "./browser";
import { assistant, history, openSession } from "./data";

test("Luna tool turns and streaming keep following until the user scrolls away", async ({
  app,
  workspace,
}, testInfo) => {
  test.setTimeout(120_000);
  await writeFile(
    join(workspace.directory, "scroll-input.txt"),
    Array.from({ length: 90 }, (_, i) => `Scroll fixture line ${i + 1}`).join(
      "\n",
    ),
  );
  const session = await history(workspace.directory, "Live scrolling", [
    assistant([{ type: "text", text: "Earlier paragraph.\n\n".repeat(80) }]),
  ]);
  await openSession(app, session.id);
  const pane = app.locator(".messages");
  const gap = () =>
    pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  await expect.poll(gap).toBeLessThan(2);

  // Sample actual layout each frame, allowing one frame for ResizeObserver.
  await pane.evaluate((el) => {
    const samples: { gap: number; tools: number; open: number }[] = [];
    Reflect.set(window, "scrollSamples", samples);
    const sample = () => {
      samples.push({
        gap: el.scrollHeight - el.clientHeight - el.scrollTop,
        tools: el.querySelectorAll(".tool-block").length,
        open: el.querySelectorAll(".tool-block[open]").length,
      });
      if (el.isConnected && samples.length < 7200)
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await send(
    app,
    "Read scroll-input.txt using the read tool in three separate sequential calls: lines 1–30, then 31–60, then 61–90. Do not use any other tools. After all three calls, write 50 numbered paragraphs, each containing the sentence 'Scrolling stays attached while new content arrives.' Do not edit files.",
  );
  await idle(app);
  const samples = await app.evaluate(() => {
    const value: unknown = Reflect.get(window, "scrollSamples");
    if (!Array.isArray(value)) throw new Error("Missing scroll samples");
    const gaps = value.map((entry: unknown) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("gap" in entry) ||
        typeof entry.gap !== "number"
      )
        throw new Error("Invalid scroll sample");
      return entry.gap;
    });
    return { gaps, json: JSON.stringify(value) };
  });
  await testInfo.attach("scroll-layout", {
    body: samples.json,
    contentType: "application/json",
  });
  await expect(app.locator(".tool-block")).toHaveCount(3);
  await expect.poll(gap).toBeLessThan(2);
  await expect(
    app.getByRole("button", { name: "Scroll to bottom" }),
  ).toHaveCount(0);
  let detachedFrames = 0;
  let worstRun = 0;
  for (const gap of samples.gaps) {
    detachedFrames = gap > 50 ? detachedFrames + 1 : 0;
    worstRun = Math.max(worstRun, detachedFrames);
  }
  expect(
    worstRun,
    "No sustained loss of following during tool turns/streaming",
  ).toBeLessThan(3);

  // Native details layout changes, without locator auto-scrolling the page.
  for (const open of [true, false, true, false]) {
    await app
      .locator(".tool-block")
      .last()
      .evaluate((el, open) => {
        if (!(el instanceof HTMLDetailsElement))
          throw new Error("Missing tool disclosure");
        el.open = open;
      }, open);
    await expect.poll(gap).toBeLessThan(2);
  }

  await pane.hover();
  await app.mouse.wheel(0, -700);
  await expect(
    app.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();
  await app.getByRole("button", { name: "Scroll to bottom" }).click();
  await expect.poll(gap).toBeLessThan(2);
});
