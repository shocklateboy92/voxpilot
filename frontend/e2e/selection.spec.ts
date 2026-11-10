import { expect, test } from "@playwright/test";

test.use({
  launchOptions: {
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
  },
  viewport: { width: 390, height: 844 },
});

for (const selectionAt of [
  "none",
  "caret",
  "start",
  "move",
  "committed",
  "end",
] as const) {
  test(`swipe handling with text selection at ${selectionAt}`, async ({
    page,
  }) => {
    // Exercise the real handler and browser Selection/Touch APIs without a
    // backend or relying on native selection-handle automation.
    await page.route("**/selection-fixture", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<div id='pane'><p>Select a word and extend the selection.</p></div>",
      }),
    );
    await page.goto("/selection-fixture");
    const result = await page.evaluate(async (selectionAt) => {
      const moduleURL = "/src/platform/gestures.ts";
      const { attachSwipeHandler }: typeof import("../src/platform/gestures") =
        await import(moduleURL);
      const element = document.getElementById("pane");
      const text = element?.querySelector("p")?.firstChild;
      const selection = document.getSelection();
      if (!element || !text || !selection)
        throw new Error("Missing selectable fixture");
      const calls: string[] = [];
      const cleanup = attachSwipeHandler(element, {
        onSwipeMove: () => calls.push("move"),
        onSwipeLeft: () => calls.push("left"),
        onSwipeRight: () => calls.push("right"),
        onSwipeCancel: () => calls.push("cancel"),
      });
      const selectWord = () => {
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 6);
        selection.removeAllRanges();
        selection.addRange(range);
      };
      const touch = (type: string, x: number) => {
        const point = new Touch({
          identifier: 1,
          target: element,
          clientX: x,
          clientY: 200,
        });
        const event = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === "touchend" ? [] : [point],
          changedTouches: [point],
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      };

      if (selectionAt === "start" || selectionAt === "caret") selectWord();
      if (selectionAt === "caret") selection.collapseToStart();
      touch("touchstart", 270);
      if (selectionAt === "committed" || selectionAt === "end") {
        touch("touchmove", 230);
      }
      if (selectionAt === "move" || selectionAt === "committed") selectWord();
      const prevented = selectionAt === "end" ? false : touch("touchmove", 110);
      if (selectionAt === "end") selectWord();
      // A selection collapsing during handle adjustment must not revive the
      // same gesture after it has already been ignored or cancelled.
      if (selectionAt !== "end") selection.removeAllRanges();
      const preventedAfterCollapse =
        selectionAt === "end" ? false : touch("touchmove", 90);
      touch("touchend", 90);
      const firstGesture = [...calls];

      // Once selection is cleared, a fresh gesture should navigate normally.
      selection.removeAllRanges();
      calls.length = 0;
      touch("touchstart", 110);
      touch("touchmove", 270);
      touch("touchend", 270);
      const nextGesture = [...calls];
      cleanup();
      return { prevented, preventedAfterCollapse, firstGesture, nextGesture };
    }, selectionAt);

    const normalSwipe = selectionAt === "none" || selectionAt === "caret";
    expect(result.prevented).toBe(normalSwipe);
    expect(result.preventedAfterCollapse).toBe(normalSwipe);
    expect(result.firstGesture).toEqual(
      normalSwipe
        ? ["move", "move", "left"]
        : selectionAt === "committed" || selectionAt === "end"
          ? ["move", "cancel"]
          : [],
    );
    expect(result.nextGesture).toEqual(["move", "right"]);
  });
}
