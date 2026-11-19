import { expect, frontendTest as test } from "./fixtures";

test.use({
  launchOptions: async ({ browserName }, use) => {
    await use(
      browserName === "chromium"
        ? {
            executablePath:
              process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
          }
        : {},
    );
  },
});

for (const touch of [false, true]) {
  test.describe(touch ? "Touch composer" : "Desktop composer", () => {
    test.use({ hasTouch: touch, viewport: { width: 390, height: 844 } });

    test("Enter inserts a newline and voice mode restores bottom navigation", async ({
      page,
    }) => {
      await page.route("**/config.json", (route) =>
        route.fulfill({ status: 404 }),
      );
      await page.route("**/api/provider", (route) =>
        route.fulfill({ json: { data: [] } }),
      );
      await page.route("**/api/model", (route) =>
        route.fulfill({ json: { data: [] } }),
      );
      await page.route("**/api/model/default", (route) =>
        route.fulfill({ json: {} }),
      );
      await page.route("**/composer-fixture", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<main></main><output aria-label="Sent message"></output>',
        }),
      );
      await page.goto("/composer-fixture");
      await page.evaluate(async () => {
        const stylesURL = "/src/styles/app.css";
        await import(stylesURL);
        document.documentElement.style.setProperty("--safe-bottom", "20px");
        const fixtureURL = "/e2e/composer-keyboard-fixture.tsx";
        const { mount }: typeof import("./composer-keyboard-fixture") =
          await import(fixtureURL);
        mount();
      });

      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(touch);
      const input = page.getByRole("textbox", { name: "Message", exact: true });
      const nav = page.locator("[data-bottom-nav]");
      const shell = page.locator(".app");
      await expect(nav).toBeVisible();
      await expect(shell).toHaveCSS("padding-bottom", "68px");
      await page.getByRole("button", { name: "Type", exact: true }).click();
      const sent = page.getByLabel("Sent message");
      await input.fill("First line");
      await input.press("End");
      await input.press("Enter");
      await expect(input).toHaveValue("First line\n");
      await expect(sent).toBeEmpty();
      await input.pressSequentially("Second line");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(sent).toHaveText("First line\nSecond line");

      // Switching mode removes the focused textarea without an explicit blur.
      // Voice mode must restore both navigation and its inherited clearance.
      for (let attempt = 0; attempt < 2; attempt++) {
        await input.focus();
        if (touch) {
          await expect(nav).toBeHidden();
          await expect(shell).toHaveCSS("padding-bottom", "0px");
        } else {
          await expect(nav).toBeVisible();
        }
        if (attempt === 0) {
          // Model a browser removing the focused textarea without bubbling blur.
          await page.evaluate(() => {
            document.addEventListener(
              "focusout",
              (event) => event.stopPropagation(),
              {
                capture: true,
                once: true,
              },
            );
          });
        }
        await page.getByRole("button", { name: "Voice", exact: true }).click();
        await expect(input).toHaveCount(0);
        await expect(shell).not.toHaveClass(/composer-keyboard-active/);
        await expect(nav).toBeVisible();
        await expect(shell).toHaveCSS("padding-bottom", "68px");
        await page.getByRole("button", { name: "Type", exact: true }).click();
      }
      await input.evaluate((element) => element.blur());
      await expect(nav).toBeVisible();
      await expect(shell).toHaveCSS("padding-bottom", "68px");
    });
  });
}
