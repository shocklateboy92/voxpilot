/**
 * Context window usage indicator.
 *
 * Shows "used / limit tokens (X%)" based on the last assistant message's
 * total token count (input + output + reasoning + cache read/write) and
 * the model's context window limit from the provider API. This matches
 * the upstream OpenCode UI calculation.
 *
 * Uses createResource to fetch provider data once, and derives usage
 * reactively from the messages store.
 */

import type { AssistantMessage } from "@opencode-ai/sdk/v2/client";
import { createMemo, createResource, Show } from "solid-js";
import { client } from "../api-client";
import { store } from "../store";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ContextUsageBar() {
  const [providers] = createResource(
    async () => {
      const result = await client.provider.list();
      return result.data;
    },
    { initialValue: undefined },
  );

  const context = createMemo(() => {
    let lastAssistant: AssistantMessage | undefined;
    for (const msg of store.messages) {
      if (msg.info.role !== "assistant") continue;
      const info = msg.info as AssistantMessage;
      if (info.tokens && info.tokens.input > 0) {
        lastAssistant = info;
      }
    }

    if (!lastAssistant?.tokens) return undefined;

    const t = lastAssistant.tokens;
    const total =
      t.input + t.output + t.reasoning + t.cache.read + t.cache.write;
    if (total <= 0) return undefined;

    const providerData = providers();
    let limit: number | undefined;
    if (providerData) {
      const provider = providerData.all.find(
        (p) => p.id === lastAssistant?.providerID,
      );
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
