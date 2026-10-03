/**
 * User preferences — persisted to localStorage.
 *
 * Extracted from store.ts so components and streaming.ts can read/write
 * the selected model without importing the full store.
 *
 * Agent selection is intentionally NOT persisted — see agent-selection.ts.
 */

import type { ModelRef } from "@opencode/client";
import { createEffect, createRoot, createSignal } from "solid-js";

const MODEL_STORAGE_KEY = "voxpilot-selected-model";
const MODEL_VARIANT_STORAGE_KEY = "voxpilot-selected-model-variant";

/**
 * Selected model as "providerID/modelID" (persisted to localStorage).
 * Empty string means "use server default".
 */
export const [selectedModelKey, setSelectedModelKey] = createSignal<string>(
  localStorage.getItem(MODEL_STORAGE_KEY) ?? "",
);

/** Selected model variant/thinking level (persisted to localStorage). */
export const [selectedModelVariant, setSelectedModelVariant] =
  createSignal<string>(localStorage.getItem(MODEL_VARIANT_STORAGE_KEY) ?? "");

// Persistence effects need an owning root so Solid doesn't warn about
// disposal-less computations. The root lives for the document lifetime.
createRoot(() => {
  createEffect(() => {
    localStorage.setItem(MODEL_STORAGE_KEY, selectedModelKey());
  });

  createEffect(() => {
    localStorage.setItem(MODEL_VARIANT_STORAGE_KEY, selectedModelVariant());
  });
});

/** Parse the persisted selection into the native model reference. */
export function selectedModel(): ModelRef | undefined {
  const key = selectedModelKey();
  if (!key) return undefined;
  const slashIdx = key.indexOf("/");
  if (slashIdx <= 0 || slashIdx === key.length - 1) return undefined;
  return {
    providerID: key.slice(0, slashIdx),
    id: key.slice(slashIdx + 1),
    variant: selectedVariant(),
  };
}

/** Selected model variant, or undefined to use the model default. */
export function selectedVariant(): string | undefined {
  const variant = selectedModelVariant().trim();
  return variant || undefined;
}
