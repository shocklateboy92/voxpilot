/**
 * Toast notification container — auto-dismissing error messages.
 *
 * Renders active toasts from the store signal as a fixed overlay.
 */

import X from "lucide-solid/icons/x";
import { For } from "solid-js";
import { IconButton } from "../ui/IconButton";
import { setToasts, toasts } from "./toast";

export function ToastContainer() {
  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div
      class="pointer-events-none fixed bottom-20 left-1/2 z-[9999] flex max-w-[min(90vw,28rem)] -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
    >
      <For each={toasts()}>
        {(toast) => (
          <div
            class="pointer-events-auto flex animate-toast-in items-center gap-2 rounded-lg border border-error bg-toast-error-bg px-4 py-3 text-sm leading-[1.4] text-error"
            role="alert"
          >
            <span class="flex-1 wrap-break-word">{toast.message}</span>
            <IconButton
              type="button"
              variant="ghost"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
            >
              <X size={14} />
            </IconButton>
          </div>
        )}
      </For>
    </div>
  );
}
