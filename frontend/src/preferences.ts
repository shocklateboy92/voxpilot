/**
 * User preferences — persisted to localStorage.
 *
 * Extracted from store.ts so components and streaming.ts can read/write
 * the selected agent/model without importing the full store.
 */

import { createEffect, createSignal } from "solid-js";

const AGENT_STORAGE_KEY = "voxpilot-selected-agent";
const MODEL_STORAGE_KEY = "voxpilot-selected-model";
const MODEL_VARIANT_STORAGE_KEY = "voxpilot-selected-model-variant";

/** Currently selected agent name (persisted to localStorage). */
export const [selectedAgent, setSelectedAgent] = createSignal<string>(
  localStorage.getItem(AGENT_STORAGE_KEY) ?? "build",
);

createEffect(() => {
  localStorage.setItem(AGENT_STORAGE_KEY, selectedAgent());
});

/**
 * Selected model as "providerID/modelID" (persisted to localStorage).
 * Empty string means "use server default".
 */
export const [selectedModelKey, setSelectedModelKey] = createSignal<string>(
  localStorage.getItem(MODEL_STORAGE_KEY) ?? "",
);

createEffect(() => {
  localStorage.setItem(MODEL_STORAGE_KEY, selectedModelKey());
});

/** Selected model variant/thinking level (persisted to localStorage). */
export const [selectedModelVariant, setSelectedModelVariant] =
  createSignal<string>(localStorage.getItem(MODEL_VARIANT_STORAGE_KEY) ?? "");

createEffect(() => {
  localStorage.setItem(MODEL_VARIANT_STORAGE_KEY, selectedModelVariant());
});

/** Parse the selected model key into the { providerID, modelID } shape the SDK expects, or undefined for default. */
export function selectedModel():
  | { providerID: string; modelID: string }
  | undefined {
  const key = selectedModelKey();
  if (!key) return undefined;
  const slashIdx = key.indexOf("/");
  if (slashIdx < 0) return undefined;
  return {
    providerID: key.slice(0, slashIdx),
    modelID: key.slice(slashIdx + 1),
  };
}

/** Selected model variant, or undefined to use the model default. */
export function selectedVariant(): string | undefined {
  const variant = selectedModelVariant().trim();
  return variant || undefined;
}
