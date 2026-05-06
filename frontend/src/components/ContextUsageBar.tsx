/**
 * Context window usage indicator.
 *
 * Shows "used / limit tokens (X%)" based on the last assistant message's
 * total token count (input + output + reasoning + cache read/write) and
 * the model's context window limit from the provider API. This matches
 * the upstream OpenCode UI calculation.
 *
 * Provider data comes from the shared `providerData` resource so we don't
 * issue a duplicate request, and usage is derived reactively from the
 * messages store.
 */

import type { AssistantMessage } from "@opencode-ai/sdk/v2/client";
import { createMemo, Show } from "solid-js";
import { providerData } from "../model-utils";
import { store } from "../store";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ContextUsageBar() {
  const context = createMemo(() => {
    let lastAssistant: AssistantMessage | undefined;
    for (const msg of store.messages) {
      if (msg.info.role !== "assistant") continue;
      // Discriminated-union narrowing: msg.info.role === "assistant"
      // narrows msg.info to AssistantMessage without a cast.
      const info = msg.info;
      if (info.tokens && info.tokens.input > 0) {
        lastAssistant = info;
      }
    }

    if (!lastAssistant?.tokens) return undefined;

    const t = lastAssistant.tokens;
    const total =
      t.input + t.output + t.reasoning + t.cache.read + t.cache.write;
    if (total <= 0) return undefined;

    const data = providerData();
    let limit: number | undefined;
    if (data) {
      const provider = data.all.find((p) => p.id === lastAssistant?.providerID);
      const model = provider?.models[lastAssistant.modelID];
      limit = model?.limit.context;
    }

    return {
      total,
      limit,
      percentage: limit ? Math.round((total / limit) * 100) : undefined,
    };
  });

  return (
    <Show when={context()}>
      {(ctx) => (
        <div class="context-usage">
          <span class="context-label">
            <Show
              when={ctx().limit}
              fallback={
                <span class="context-detail">
                  {formatTokens(ctx().total)} tokens
                </span>
              }
            >
              {(limit) => (
                <>
                  <span class="context-total">{formatTokens(ctx().total)}</span>
                  <span class="context-limit">/</span>
                  <span class="context-limit">{formatTokens(limit())}</span>
                  <span class="context-total">tokens</span>
                  <span class="context-percentage">({ctx().percentage}%)</span>
                </>
              )}
            </Show>
          </span>
        </div>
      )}
    </Show>
  );
}
