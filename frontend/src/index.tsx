import { render } from "solid-js/web";
import { App } from "./App";
import { extractErrorMessage, showToast } from "./store";

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

const root = document.getElementById("root");
if (root) {
  render(() => <App />, root);
}
