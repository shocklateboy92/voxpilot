/**
 * Toast notification container — auto-dismissing error messages.
 *
 * Renders active toasts from the store signal as a fixed overlay.
 */

import X from "lucide-solid/icons/x";
import { For } from "solid-js";
import { setToasts, toasts } from "../toast";

export function ToastContainer() {
  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div class="toast-container" aria-live="polite">
      <For each={toasts()}>
        {(toast) => (
          <div class="toast toast-error" role="alert">
            <span class="toast-message">{toast.message}</span>
            <button
              class="toast-dismiss"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
