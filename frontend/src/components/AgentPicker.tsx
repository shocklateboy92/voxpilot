/**
 * Agent/mode picker — segmented control rendered above the chat input.
 *
 * Shows all primary agents as equal-width buttons in a pill shape.
 * Only renders when 2+ primary agents are available.
 */

import { For, Show } from "solid-js";
import { effectiveAgent, setEffectiveAgent } from "../agent-selection";
import { isStreaming } from "../navigation";
import { store } from "../store";

export function AgentPicker() {
  return (
    <Show when={store.agents.length > 1}>
      <div class="agent-segmented">
        <For each={store.agents}>
          {(agent) => (
            <button
              type="button"
              class="agent-segmented-btn"
              classList={{
                "agent-segmented-btn-active": agent.name === effectiveAgent(),
              }}
              onClick={() => setEffectiveAgent(agent.name)}
              disabled={isStreaming()}
              title={agent.description}
            >
              {agent.name}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
