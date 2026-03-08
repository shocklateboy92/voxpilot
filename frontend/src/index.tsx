import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
import { Dynamic, render } from "solid-js/web";
import { Spinner } from "./components/Spinner";
import { OfflineOverlay } from "./components/OfflineOverlay";
import { rpc } from "./rpc";
import { extractErrorMessage, showToast } from "./toast";
import "./style.css";

// ── Global unhandled-rejection handler ───────────────────────────────────────
// Acts as a catch-all for async errors that aren't handled locally, similar
// to global exception middleware in server-side frameworks.  Any unhandled
// promise rejection (e.g. a failed API call) surfaces as a toast notification.
window.addEventListener(
  "unhandledrejection",
  (event: PromiseRejectionEvent) => {
    event.preventDefault();
    showToast(extractErrorMessage(event.reason));
  },
);

// ── Dynamic app import ──────────────────────────────────────────────────────
// Triggers store.ts's top-level await (init), streaming setup, and the
// entire component tree. A signal + <Show> replaces lazy() + <Suspense>
// so that no app-level Suspense boundary exists — stray createResource
// calls in child components can never tear down the component tree.
const [AppComponent, setAppComponent] = createSignal<Component>();
const [offline, setOffline] = createSignal(false);

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network/i.test(err.message);
}

import("./App").then(
  (m) => {
    setAppComponent(() => m.default);
    // Persist wake URL for offline fallback
    rpc.api.config
      .$get()
      .then((r) => r.json())
      .then((data) => {
        if (data.wakeUrl) {
          localStorage.setItem("voxpilot:wakeUrl", data.wakeUrl);
        }
      })
      .catch(() => {});
  },
  (err) => {
    if (isNetworkError(err)) {
      setOffline(true);
    } else {
      showToast(extractErrorMessage(err));
    }
  },
);

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <Show when={!offline()} fallback={<OfflineOverlay />}>
        <Show when={AppComponent()} fallback={<Spinner fullscreen />}>
          {(App) => <Dynamic component={App()} />}
        </Show>
      </Show>
    ),
    root,
  );
}
