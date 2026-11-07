import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
import { Dynamic, render } from "solid-js/web";
import { ToastContainer } from "./app/ToastContainer";
import { ConnectionPage } from "./features/connection/ConnectionPage";
import { OfflineOverlay } from "./features/connection/OfflineOverlay";
import { waitForPlugin, wakeStorageKey } from "./platform/connection";
import {
  configuredServer,
  connectionConfig,
  requestedServerUrl,
} from "./platform/connection-config";
import { rpc } from "./platform/rpc";
import { Spinner } from "./ui/Spinner";
import "./styles/app.css";
import { extractErrorMessage, showToast } from "./app/toast";

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

const initiallyConnecting =
  Boolean(connectionConfig.error) ||
  (connectionConfig.servers.length > 0
    ? !configuredServer
    : !localStorage.getItem("voxpilot:server") ||
      (requestedServerUrl !== undefined &&
        requestedServerUrl !== localStorage.getItem("voxpilot:server"))) ||
  new URLSearchParams(window.location.search).has("connect");
const [connecting, setConnecting] = createSignal(initiallyConnecting);

if (!initiallyConnecting)
  waitForPlugin()
    .then(() => import("./app/App"))
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
        // Keep the error visible instead of losing it in a redirect loop.
        setConnecting(true);
      },
    );

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <Show
        when={!connecting()}
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
