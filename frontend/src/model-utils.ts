/**
 * Shared model/variant display utilities.
 *
 * - formatVariantLabel: converts variant IDs ("high", "medium-thinking")
 *   into display labels ("High", "Medium Thinking").
 * - providerData / resolveModelName: cached provider resource and lookup
 *   so both ModelPicker and MessageBubble can resolve display names.
 */

import { createResource } from "solid-js";
import { fetchProviders } from "./api-client";

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

/** Shared cached resource for provider data. Fetched once per app lifecycle. */
export const [providerData] = createResource(fetchProviders);

/**
 * Look up a model's display name from provider metadata.
 * Returns the raw modelID if the provider/model is not found (graceful fallback).
 */
export function resolveModelName(providerID: string, modelID: string): string {
  const data = providerData();
  if (!data) return modelID;

  const provider = data.all.find((p) => p.id === providerID);
  if (!provider) return modelID;

  const model = provider.models[modelID];
  return model?.name ?? modelID;
}
