/**
 * Model picker — selector cluster rendered above the chat input.
 *
 * Shows connected providers and their models in grouped <optgroup> sections.
 * When the selected explicit model exposes variants, a second selector appears
 * for the model's thinking/reasoning level.
 */

import { createEffect, createMemo, For, Show } from "solid-js";
import {
  defaultModelData,
  formatVariantLabel,
  modelData,
  providerData,
} from "../model-utils";
import { isStreaming } from "../navigation";
import {
  selectedModel,
  selectedModelKey,
  selectedModelVariant,
  setSelectedModelKey,
  setSelectedModelVariant,
} from "../preferences";

export function ModelPicker() {
  const connectedProviders = createMemo(() => {
    return (providerData() ?? [])
      .filter((provider) => provider.activation !== "disabled")
      .map((provider) => ({
        ...provider,
        models: (modelData() ?? []).filter(
          (model) => model.providerID === provider.id && model.enabled,
        ),
      }))
      .filter((provider) => provider.models.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const hasModels = createMemo(() => {
    return connectedProviders().some((provider) => {
      return provider.models.length > 0;
    });
  });

  const activeModel = createMemo(() => {
    const model = selectedModel();
    if (!model) return undefined;

    const provider = connectedProviders().find(
      (entry) => entry.id === model.providerID,
    );
    return provider?.models.find((entry) => entry.id === model.id);
  });

  const variantEntries = createMemo(() => {
    const model = activeModel();
    if (!model?.variants) return [];

    return [...model.variants]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((variant) => ({
        id: variant.id,
        label: formatVariantLabel(variant.id),
      }));
  });

  const showVariantPicker = createMemo(() => {
    return variantEntries().length > 0;
  });

  createEffect(() => {
    if (modelData.loading || providerData.loading || defaultModelData.loading)
      return;
    const variants = variantEntries();
    const current = selectedModelVariant();

    if (variants.length === 0) {
      if (current) setSelectedModelVariant("");
      return;
    }

    if (!current) return;
    if (variants.some((variant) => variant.id === current)) return;
    setSelectedModelVariant("");
  });

  return (
    <Show when={hasModels()}>
      <div class="model-picker">
        <div class="model-picker-pill">
          <select
            class="model-select"
            value={selectedModelKey()}
            onChange={(e) => setSelectedModelKey(e.currentTarget.value)}
            disabled={isStreaming()}
          >
            <option value="">
              Default model
              {defaultModelData() ? ` (${defaultModelData()?.name})` : ""}
            </option>
            <For each={connectedProviders()}>
              {(provider) => (
                <optgroup label={provider.name}>
                  <For
                    each={[...provider.models].sort((a, b) =>
                      a.name.localeCompare(b.name),
                    )}
                  >
                    {(model) => (
                      <option value={`${provider.id}/${model.id}`}>
                        {model.name}
                      </option>
                    )}
                  </For>
                </optgroup>
              )}
            </For>
          </select>

          <Show when={showVariantPicker()}>
            <select
              class="model-select model-variant-select"
              value={selectedModelVariant()}
              onChange={(e) => setSelectedModelVariant(e.currentTarget.value)}
              disabled={isStreaming()}
            >
              <option value="">Default thinking</option>
              <For each={variantEntries()}>
                {(variant) => (
                  <option value={variant.id}>{variant.label}</option>
                )}
              </For>
            </select>
          </Show>
        </div>
      </div>
    </Show>
  );
}
