// Retirement endpoint for the Workbox worker shipped by older VoxPilot builds.
// Keep this URL as JavaScript: HTML/404 responses leave the old worker installed.
// Current builds do not register a worker or cache new responses.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Take over from the cache-serving worker without reloading open pages:
      // an automatic reload could discard drafts or interrupt a recording.
      await self.clients.claim();
      const scope = self.registration.scope;
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              ((name.startsWith("workbox-precache-v2-") ||
                name.startsWith("workbox-runtime-")) &&
                name.endsWith(scope)) ||
              (name === "config-cache" && new URL(scope).pathname === "/"),
          )
          .map((name) => caches.delete(name)),
      );
      await self.registration.unregister();
    })(),
  );
});
