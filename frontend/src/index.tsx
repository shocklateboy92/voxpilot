import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
import { Dynamic, render } from "solid-js/web";
import { ConnectionPage } from "./components/ConnectionPage";
import { OfflineOverlay } from "./components/OfflineOverlay";
import { Spinner } from "./components/Spinner";
import { ToastContainer } from "./components/ToastContainer";
import { changeServer, waitForPlugin, wakeStorageKey } from "./connection";
import { rpc } from "./rpc";
import "./style.css";
import { extractErrorMessage, showToast } from "./toast";

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

const connecting =
  !localStorage.getItem("voxpilot:server") ||
  new URLSearchParams(window.location.search).has("connect");

if (!connecting)
  waitForPlugin()
    .then(() => import("./App"))
    .then(
      (m) => {
        setAppComponent(() => m.default);
        // Persist wake URL for offline fallback
        rpc
          .config({})
          .then((data) => {
            if (data.wakeUrl) {
              localStorage.setItem(wakeStorageKey, data.wakeUrl);
            }
          })
          .catch(() => {});
      },
      (err) => {
        showToast(extractErrorMessage(err));
        changeServer();
      },
    );

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <Show
        when={!connecting}
        fallback={
          <>
            <ConnectionPage />
            <ToastContainer />
          </>
        }
      >
        <OfflineOverlay>
          <Show when={AppComponent()} fallback={<Spinner fullscreen />}>
            {(App) => <Dynamic component={App()} />}
          </Show>
        </OfflineOverlay>
      </Show>
    ),
    root,
  );
}
