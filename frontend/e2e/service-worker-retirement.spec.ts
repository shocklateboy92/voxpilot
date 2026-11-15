import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

test.use({
  launchOptions: {
    executablePath: process.env.VOXPILOT_E2E_CHROMIUM ?? "/usr/bin/chromium",
  },
});

test("retiring an installed cache-serving worker recovers the latest frontend without clearing drafts", async ({
  page,
}) => {
  const retirement = await readFile(
    new URL("../public/sw.js", import.meta.url),
    "utf8",
  );
  const legacy = `
    self.addEventListener("install", (event) => {
      event.waitUntil(self.skipWaiting());
    });
    self.addEventListener("activate", (event) => {
      event.waitUntil((async () => {
        const cache = await caches.open("workbox-precache-v2-" + self.registration.scope);
        await cache.put(new URL("index.html", self.registration.scope), new Response(
          '<main>Old frontend</main><input aria-label="Draft">',
          { headers: { "Content-Type": "text/html" } },
        ));
        await caches.open("config-cache");
        await self.clients.claim();
      })());
    });
    self.addEventListener("fetch", (event) => {
      if (event.request.mode !== "navigate") return;
      event.respondWith(caches.match(new URL("index.html", self.registration.scope)));
    });
  `;
  let mode: "legacy" | "html" | "retirement" = "legacy";
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/sw.js" && mode !== "html") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(mode === "legacy" ? legacy : retirement);
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end("<main>Current frontend</main>");
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test server address");
    await page.goto(
      `http://127.0.0.1:${address.port}/?serverId=dev2#session-kept`,
    );
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    await page.reload();
    await expect(page.locator("main")).toHaveText("Old frontend");

    // This is what the SPA fallback served after sw.js disappeared from builds.
    mode = "html";
    const updateFailed = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error("Missing legacy worker");
      try {
        await registration.update();
        return false;
      } catch {
        return true;
      }
    });
    expect(updateFailed).toBe(true);
    await page.reload();
    await expect(page.locator("main")).toHaveText("Old frontend");
    await page.getByRole("textbox", { name: "Draft" }).fill("Keep my draft");
    await page.evaluate(async () => {
      localStorage.setItem("voxpilot-composer-mode", "voice");
      sessionStorage.setItem("keep-session", "yes");
      await caches.open(`workbox-precache-v2-${location.origin}/other-app/`);
      await caches.open("unrelated-cache");
    });

    mode = "retirement";
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error("Missing legacy worker");
      await registration.update();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistrations()).length,
        ),
      )
      .toBe(0);
    const remaining = await page.evaluate(() => caches.keys());
    expect(remaining).toEqual(expect.arrayContaining(["unrelated-cache"]));
    expect(remaining.some((name) => name.endsWith("/other-app/"))).toBe(true);
    expect(remaining).not.toContain("config-cache");
    expect(remaining).not.toContain(
      `workbox-precache-v2-http://127.0.0.1:${address.port}/`,
    );
    await expect(page.getByRole("textbox", { name: "Draft" })).toHaveValue(
      "Keep my draft",
    );

    // The retirement worker has no fetch handler. The next normal navigation
    // gets the current frontend, with the route and browser storage intact.
    await page.reload();
    await expect(page.locator("main")).toHaveText("Current frontend");
    await expect(page).toHaveURL(/serverId=dev2#session-kept$/);
    expect(
      await page.evaluate(() => localStorage.getItem("voxpilot-composer-mode")),
    ).toBe("voice");
    expect(
      await page.evaluate(() => sessionStorage.getItem("keep-session")),
    ).toBe("yes");
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller),
    ).toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      server.closeAllConnections();
    });
  }
});
