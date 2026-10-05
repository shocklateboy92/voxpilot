/**
 * Client-side Screen Wake Lock for keeping the device screen awake
 * while the AI is actively streaming responses.
 *
 * Uses the Screen Wake Lock API (navigator.wakeLock) to prevent the
 * screen from dimming or locking on phones/tablets/laptops while any
 * AI session is busy. The lock is released as soon as all sessions
 * go idle.
 *
 * Reactively driven by store.sessionStatuses via a SolidJS createEffect,
 * so no manual event wiring is needed — streaming.ts already maintains
 * the session status store entries.
 *
 * The wake lock is automatically released by the browser when the page
 * becomes hidden (tab switch, screen off). We re-acquire it when the
 * page becomes visible again, but only if a session is still busy.
 *
 * Gracefully no-ops if the API is unavailable (older browsers, insecure
 * contexts without HTTPS).
 */

import { createEffect, createRoot } from "solid-js";
import { store } from "./store";

let sentinel: WakeLockSentinel | null = null;
let shouldBeActive = false;

function isSupported(): boolean {
  return "wakeLock" in navigator;
}

async function acquire(): Promise<void> {
  if (!isSupported()) return;
  if (sentinel) return; // already held

  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
  } catch {
    // Acquisition can fail if the page is hidden or the browser
    // denies the request. This is expected and safe to ignore.
    sentinel = null;
  }
}

function release(): void {
  if (sentinel) {
    void sentinel.release();
    sentinel = null;
  }
}

// ── Reactive wake lock management ───────────────────────────────

// The effect needs an owning root so Solid doesn't warn about
// disposal-less computations. The root lives for the document lifetime.
createRoot(() => {
  createEffect(() => {
    const anyBusy = Object.values(store.sessionStatuses).some(
      (s) => s.type === "busy",
    );

    if (anyBusy) {
      shouldBeActive = true;
      void acquire();
    } else {
      shouldBeActive = false;
      release();
    }
  });
});

// Re-acquire the wake lock when the page becomes visible again,
// but only if a session is still busy. The browser automatically
// releases the lock when the page is hidden.
if (isSupported()) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && shouldBeActive) {
      void acquire();
    }
  });
}
