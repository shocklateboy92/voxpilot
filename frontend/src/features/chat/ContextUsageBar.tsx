/**
 * Context window usage indicator.
 *
 * Shows "used / limit tokens (X%)" based on the last assistant message's
 * total token count (input + output + reasoning + cache read/write) and
 * the model's context window limit from the model catalog. This matches
 * the upstream OpenCode UI calculation.
 *
 * Model data comes from the shared `modelData` resource so we don't
 * issue a duplicate request, and usage is derived reactively from the
 * messages store.
 */

import type { SessionMessageAssistant as AssistantMessage } from "@opencode/client";
import { createMemo, Show } from "solid-js";
import { store } from "../../app/store";
import { modelData } from "./model-utils";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ContextUsageBar() {
  const context = createMemo(() => {
    let lastAssistant: AssistantMessage | undefined;
    for (const msg of store.messages) {
      if (msg.type !== "assistant") continue;
      const info = msg;
      if (info.tokens && info.tokens.input > 0) {
        lastAssistant = info;
      }
    }

    if (!lastAssistant?.tokens) return undefined;

    const t = lastAssistant.tokens;
    const total =
      t.input + t.output + t.reasoning + t.cache.read + t.cache.write;
    if (total <= 0) return undefined;

    const modelRef = lastAssistant.model;
    const limit = modelData()?.find(
      (model) =>
        model.providerID === modelRef.providerID && model.id === modelRef.id,
    )?.limit.context;

    return {
      total,
      limit,
      percentage: limit ? Math.round((total / limit) * 100) : undefined,
    };
  });

  return (
    <Show when={context()}>
      {(ctx) => (
        <div class="ml-auto flex min-w-0 items-center gap-1.5">
          <span class="flex min-w-0 gap-[0.75em] font-mono text-[0.7rem] whitespace-nowrap text-muted">
            <Show
              when={ctx().limit}
              fallback={
                <span class="min-w-0 shrink truncate">
                  {formatTokens(ctx().total)} tokens
                </span>
              }
            >
              {(limit) => (
                <>
                  <span class="hidden min-[370px]:inline">
                    {formatTokens(ctx().total)}
                  </span>
                  <span class="hidden min-[440px]:inline">/</span>
                  <span class="hidden min-[440px]:inline">
                    {formatTokens(limit())}
                  </span>
                  <span class="hidden min-[370px]:inline">tokens</span>
                  <span class="shrink-0">({ctx().percentage}%)</span>
                </>
              )}
            </Show>
          </span>
        </div>
      )}
    </Show>
  );
}
