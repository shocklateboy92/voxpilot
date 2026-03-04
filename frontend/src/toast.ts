/**
 * Toast notification state.
 *
 * Extracted from store.ts so non-component modules (streaming.ts, etc.)
 * can show toasts without importing the full store.
 */

import { createSignal } from "solid-js";

export interface Toast {
  id: number;
  message: string;
}

let nextToastId = 0;

/** Toast notifications. */
export const [toasts, setToasts] = createSignal<Toast[]>([]);

const TOAST_DURATION_MS = 5000;

export function showToast(message: string): void {
  const id = nextToastId++;
  setToasts((prev) => [...prev, { id, message }]);
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, TOAST_DURATION_MS);
}

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unexpected error occurred";
}
