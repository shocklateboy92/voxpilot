/**
 * Agent selection — which agent the picker shows and which one
 * `sendUserMessage` sends with.
 *
 * Resolution order for `effectiveAgent()`:
 *   1. No active session (New Session page) → DEFAULT_AGENT.
 *   2. User clicked the picker since switching to this conversation
 *      → that override.
 *   3. The agent that produced the most recent assistant message in
 *      the active conversation.
 *   4. DEFAULT_AGENT.
 *
 * The override is a single in-memory signal that is reset whenever
 * `activeSessionId` changes — switching conversations discards any
 * unused picker selection by design.
 */

import { createEffect, createRoot, createSignal } from "solid-js";
import { activeSessionId } from "./navigation";
import { store } from "./store";

export const DEFAULT_AGENT = "plan";

const [currentAgentOverride, setCurrentAgentOverride] = createSignal<
  string | undefined
>(undefined);

// Reset the override whenever the active conversation changes.
// Wrapped in createRoot so the effect has an owner — without this, Solid
// emits a "computations created outside a `createRoot` or `render` will
// never be disposed" dev warning, and any onCleanup inside would silently
// no-op. The lifetime is the whole document anyway, so the root is never
// disposed.
createRoot(() => {
  createEffect(() => {
    activeSessionId();
    setCurrentAgentOverride(undefined);
  });
});

/**
 * The `agent` field of the most recent assistant message in the
 * currently loaded conversation, or undefined if none.
 */
function lastAssistantAgent(): string | undefined {
  const msgs = store.messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const info = msgs[i]?.info;
    if (info?.role === "assistant" && info.agent) {
      return info.agent;
    }
  }
  return undefined;
}

/** The agent the picker should show and `sendUserMessage` should use. */
export function effectiveAgent(): string {
  const override = currentAgentOverride();
  if (override) return override;
  if (!activeSessionId()) return DEFAULT_AGENT;
  return lastAssistantAgent() ?? DEFAULT_AGENT;
}

/** Record an explicit picker selection for the active conversation. */
export function setEffectiveAgent(name: string): void {
  setCurrentAgentOverride(name);
}
