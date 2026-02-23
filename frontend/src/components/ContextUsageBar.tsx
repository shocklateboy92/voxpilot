/**
 * Context window usage indicator — shows token usage as a compact progress bar.
 *
 * Displayed only when usage data is available (after at least one LLM call).
 */

import { Show } from "solid-js";
import { contextUsage } from "../store";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ContextUsageBar() {
  const percentage = () => {
    const usage = contextUsage();
    if (!usage || usage.contextWindow === 0) return 0;
    return Math.min((usage.totalTokens / usage.contextWindow) * 100, 100);
  };

  const barClass = () => {
    const pct = percentage();
    if (pct >= 90) return "context-bar-fill context-bar-danger";
    if (pct >= 70) return "context-bar-fill context-bar-warn";
    return "context-bar-fill";
  };

  return (
    <Show when={contextUsage()}>
      {(usage) => (
        <div class="context-usage" title={`Prompt: ${usage().promptTokens} | Completion: ${usage().completionTokens}`}>
          <span class="context-label">
            {formatTokens(usage().totalTokens)} / {formatTokens(usage().contextWindow)}
          </span>
          <div class="context-bar">
            <div class={barClass()} style={{ width: `${percentage()}%` }} />
          </div>
        </div>
      )}
    </Show>
  );
}
