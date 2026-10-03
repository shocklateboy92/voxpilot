/**
 * Shared model/variant display utilities.
 *
 * - formatVariantLabel: converts variant IDs ("high", "medium-thinking")
 *   into display labels ("High", "Medium Thinking").
 * - modelData / resolveModelName: cached model catalog and lookup
 *   so both ModelPicker and MessageBubble can resolve display names.
 */

import { createResource, createRoot } from "solid-js";
import { fetchDefaultModel, fetchModels, fetchProviders } from "./api-client";

/**
 * Convert a variant ID like "high" or "medium-thinking" to a display label.
 * The SDK does not provide user-facing names for variants.
 */
export function formatVariantLabel(variantID: string): string {
  return variantID
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Shared cached catalogs. Fetched once per app lifecycle.
 *
 * Wrapped in createRoot so the resource has an owner — without one Solid
 * warns about disposal-less computations. The root is never disposed.
 */
export const [providerData] = createRoot(() => createResource(fetchProviders));
export const [modelData] = createRoot(() => createResource(fetchModels));
export const [defaultModelData] = createRoot(() =>
  createResource(fetchDefaultModel),
);

/**
 * Look up a model's display name from the native catalog.
 * Returns the raw modelID if the provider/model is not found (graceful fallback).
 */
export function resolveModelName(providerID: string, modelID: string): string {
  const model = modelData()?.find(
    (model) => model.providerID === providerID && model.id === modelID,
  );
  return model?.name ?? modelID;
}
