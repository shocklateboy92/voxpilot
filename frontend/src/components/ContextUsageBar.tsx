/**
 * Context window usage indicator.
 *
 * Shows "used / limit tokens (X%)" based on the last assistant message's
 * input token count (which represents the full conversation context the
 * model saw) and the model's context window limit from the provider API.
 *
 * Uses createResource to fetch provider data once, and derives usage
 * reactively from the messages store.
 */

import type { AssistantMessage } from "@opencode-ai/sdk/v2/client";
import { createMemo, createResource, Show } from "solid-js";
import { client } from "../api-client";
import { agents, messages, selectedAgent } from "../store";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ContextUsageBar() {
  // Fetch provider data once to look up context window limits.
  const [providers] = createResource(async () => {
    const result = await client.provider.list();
    return result.data;
  });

  // Resolve the context window limit for the currently selected agent's model.
  const contextLimit = createMemo(() => {
    const providerData = providers();
    if (!providerData) return undefined;

    const agent = agents().find((a) => a.name === selectedAgent());
    if (!agent?.model) return undefined;

    const provider = providerData.all.find(
      (p) => p.id === agent.model!.providerID,
    );
    if (!provider) return undefined;

    const model = provider.models[agent.model.modelID];
    return model?.limit.context;
  });

  // Find the last assistant message's input tokens — this represents
  // how much of the context window was consumed on the most recent turn.
  const lastInputTokens = createMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      if (msg.info.role !== "assistant") continue;
      const info = msg.info as AssistantMessage;
      if (info.tokens && info.tokens.input > 0) {
        return info.tokens.input;
      }
    }
    return 0;
  });

  const percentage = createMemo(() => {
    const limit = contextLimit();
    const used = lastInputTokens();
    if (!limit || !used) return undefined;
    return Math.round((used / limit) * 100);
  });

  return (
    <Show when={lastInputTokens() > 0}>
      <div class="context-usage">
        <span class="context-label">
          <Show
            when={contextLimit()}
            fallback={<>{formatTokens(lastInputTokens())} tokens</>}
          >
            {(limit) => (
              <>
                {formatTokens(lastInputTokens())} / {formatTokens(limit())}{" "}
                tokens ({percentage()}%)
              </>
            )}
          </Show>
        </span>
      </div>
    </Show>
  );
}
