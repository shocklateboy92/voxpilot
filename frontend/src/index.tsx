import { render } from "solid-js/web";
import { lazy, Suspense } from "solid-js";
import { extractErrorMessage, showToast } from "./toast";
import "./style.css";

// Lazy-load the app — this triggers store.ts's top-level await (init),
// streaming setup, and the entire component tree. The Suspense fallback
// shows a spinner until everything is ready.
const App = lazy(() => import("./App"));

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

function FullScreenSpinner() {
  return (
    <main class="app" style={{ display: "flex", "align-items": "center", "justify-content": "center", height: "100dvh" }}>
      <div class="spinner" />
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <Suspense fallback={<FullScreenSpinner />}>
        <App />
      </Suspense>
    ),
    root,
  );
}
