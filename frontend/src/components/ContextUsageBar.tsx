/**
 * Context window usage indicator — shows token usage.
 */

import { Show } from "solid-js"
import { contextUsage } from "../store"

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function ContextUsageBar() {
  const totalTokens = () => {
    const usage = contextUsage()
    if (!usage) return 0
    return usage.inputTokens + usage.outputTokens
  }

  return (
    <Show when={contextUsage()}>
      {(usage) => (
        <div class="context-usage" title={`In: ${usage().inputTokens} | Out: ${usage().outputTokens} | Reasoning: ${usage().reasoningTokens} | Cache R: ${usage().cacheRead} | Cache W: ${usage().cacheWrite}`}>
          <span class="context-label">
            {formatTokens(totalTokens())} tokens
          </span>
        </div>
      )}
    </Show>
  )
}

