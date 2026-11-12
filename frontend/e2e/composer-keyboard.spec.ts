import { expect, frontendTest as test } from "./fixtures";

test.use({
  launchOptions: {
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
  },
});

for (const touch of [false, true]) {
  test.describe(touch ? "Touch composer" : "Desktop composer", () => {
    test.use({ hasTouch: touch, viewport: { width: 390, height: 844 } });

    test("Enter preserves mobile newlines and desktop submission", async ({
      page,
    }) => {
      await page.route("**/composer-fixture", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<main></main><output aria-label="Sent message"></output>',
        }),
      );
      await page.goto("/composer-fixture");
      await page.evaluate(async () => {
        const webURL = "/node_modules/solid-js/web/dist/web.js";
        const { render }: typeof import("solid-js/web") = await import(webURL);
        const composerURL = "/src/features/chat/MessageComposer.tsx";
        const {
          MessageComposer,
        }: typeof import("../src/features/chat/MessageComposer") = await import(
          composerURL
        );
        const main = document.querySelector("main");
        const output = document.querySelector("output");
        if (!main || !output) throw new Error("Missing fixture elements");
        render(
          () =>
            MessageComposer({
              onSend: async (draft) => {
                output.textContent = draft.text;
                return false;
              },
            }),
          main,
        );
      });

      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(touch);
      const input = page.getByRole("textbox", { name: "Message", exact: true });
      const sent = page.getByLabel("Sent message");
      await input.fill("First line");
      await input.press("End");
      await input.press("Enter");
      if (touch) {
        await expect(input).toHaveValue("First line\n");
        await expect(sent).toBeEmpty();
        await input.pressSequentially("Second line");
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(sent).toHaveText("First line\nSecond line");
      } else {
        await expect(sent).toHaveText("First line");
        await expect(input).toHaveValue("First line");
        await input.press("Shift+Enter");
        await expect(input).toHaveValue("First line\n");
        await expect(sent).toHaveText("First line");
      }
    });
  });
}
