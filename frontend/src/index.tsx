import { render } from "solid-js/web";
import { App } from "./App";
import { showToast, extractErrorMessage } from "./store";
import { ApiError } from "./api-client";

// ── Global unhandled-rejection handler ───────────────────────────────────────
// Acts as a catch-all for async errors that aren't handled locally, similar
// to global exception middleware in server-side frameworks.  Any unhandled
// promise rejection (e.g. a failed API call) surfaces as a toast notification.
// If the rejection is a 401, reload the page so the user can re-authenticate.
window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  event.preventDefault();

  if (event.reason instanceof ApiError && event.reason.status === 401) {
    window.location.reload();
    return;
  }

  showToast(extractErrorMessage(event.reason));
});

const root = document.getElementById("root");
if (root) {
  render(() => <App />, root);
}
