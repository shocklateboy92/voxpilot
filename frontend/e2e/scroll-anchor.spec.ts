import { expect, frontendTest as test } from "./fixtures";

test.use({
  launchOptions: {
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
  },
  viewport: { width: 390, height: 844 },
});

test.beforeEach(async ({ page }) => {
  await page.route("**/scroll-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div role="main" style="height:400px;overflow:auto;box-sizing:border-box"><article>
        <div style="height:1200px">History</div>
        <details open><summary>Running tool</summary><pre style="height:600px">Tool input</pre></details>
        <div id="tail">Streaming response</div>
      </article></div><output></output><button>Bottom</button>`,
    }),
  );
  await page.goto("/scroll-fixture");
  await page.evaluate(async () => {
    const url = "/e2e/scroll-anchor-fixture.ts";
    const fixture: typeof import("./scroll-anchor-fixture") = await import(url);
    fixture.mount();
  });
  await expect
    .poll(() =>
      page
        .getByRole("main")
        .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThan(2);
});

test("layout scroll events before ResizeObserver do not cancel following", async ({
  page,
}) => {
  const pane = page.getByRole("main");
  for (let cycle = 0; cycle < 5; cycle++) {
    await pane.evaluate((el) => {
      const tail = el.querySelector("#tail");
      if (!tail) throw new Error("Missing tail");
      tail.append(document.createElement("div"));
      tail.lastElementChild?.setAttribute("style", "height:300px");
      // Scroll events (including browser anchoring) can precede resize delivery.
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(page.locator("output")).toHaveText("following");
    await expect
      .poll(() =>
        pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
      )
      .toBeLessThan(2);
  }
});

test("tool collapse and expansion keep the bottom pinned", async ({ page }) => {
  const pane = page.getByRole("main");
  for (const open of [false, true, false, true]) {
    await page.locator("details").evaluate((el, open) => {
      if (!(el instanceof HTMLDetailsElement)) throw new Error("Missing tool");
      el.open = open;
    }, open);
    await expect
      .poll(() =>
        pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
      )
      .toBeLessThan(2);
    await expect(page.locator("output")).toHaveText("following");
  }
});

test("viewport and composer padding changes keep following", async ({
  page,
}) => {
  const pane = page.getByRole("main");
  await pane.evaluate((el) => {
    el.style.height = "250px";
  });
  await expect
    .poll(() =>
      pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThan(2);
  await pane.evaluate((el) => {
    el.style.paddingBottom = "180px";
  });
  await expect
    .poll(() =>
      pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThan(2);
});

test("reading history survives layout changes and Bottom resumes during growth", async ({
  page,
}) => {
  const pane = page.getByRole("main");
  await pane.hover();
  await page.mouse.wheel(0, -500);
  await expect(page.locator("output")).toHaveText("reading");
  const position = await pane.evaluate((el) => el.scrollTop);
  await page.locator("#tail").evaluate((el) => {
    el.style.height = "800px";
  });
  await expect
    .poll(() => pane.evaluate((el) => el.scrollHeight))
    .toBeGreaterThan(2500);
  expect(await pane.evaluate((el) => el.scrollTop)).toBeCloseTo(position, 0);
  await page.getByRole("button", { name: "Bottom" }).click();
  await page.locator("#tail").evaluate((el) => {
    el.style.height = "1600px";
  });
  await expect(page.locator("output")).toHaveText("following");
  await expect
    .poll(() =>
      pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThan(2);
});

test("layout clamping while reading does not silently re-enable following", async ({
  page,
}) => {
  const pane = page.getByRole("main");
  await pane.hover();
  await page.mouse.wheel(0, -300);
  await expect(page.locator("output")).toHaveText("reading");
  await page.locator("details").evaluate((el) => {
    el.removeAttribute("open");
  });
  await expect
    .poll(() => pane.evaluate((el) => el.scrollHeight))
    .toBeLessThan(1400);
  await expect(page.locator("output")).toHaveText("reading");
  await page.locator("details").evaluate((el) => {
    el.setAttribute("open", "");
  });
  await expect
    .poll(() =>
      pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeGreaterThan(50);
  await expect(page.locator("output")).toHaveText("reading");
  await page.mouse.wheel(0, 2000);
  await expect(page.locator("output")).toHaveText("following");
});

test("scrolling up in the same frame as growth still leaves follow mode", async ({
  page,
}) => {
  const pane = page.getByRole("main");
  await pane.evaluate((el) => {
    const tail = el.querySelector("#tail");
    if (!(tail instanceof HTMLElement)) throw new Error("Missing tail");
    tail.style.height = "1000px";
    el.scrollTop -= 300;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect(page.locator("output")).toHaveText("reading");
  await expect
    .poll(() =>
      pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeGreaterThan(1000);
});

test("restore retries until reachable, and Bottom cancels an unreachable restore", async ({
  page,
}) => {
  const pane = page.getByRole("main");
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("restore-position", { detail: 2000 }),
    ),
  );
  await expect(page.locator("output")).toHaveText("reading");
  await page.locator("#tail").evaluate((el) => {
    el.style.height = "1600px";
  });
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(2000);
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("restore-position", { detail: 9999 }),
    ),
  );
  await page.getByRole("button", { name: "Bottom" }).click();
  await page.locator("#tail").evaluate((el) => {
    el.style.height = "2000px";
  });
  await expect(page.locator("output")).toHaveText("following");
  await expect
    .poll(() =>
      pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThan(2);
});
