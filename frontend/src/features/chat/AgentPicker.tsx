/**
 * Agent/mode picker — segmented control rendered above the chat input.
 *
 * Shows all primary agents as equal-width buttons in a pill shape.
 * Only renders when 2+ primary agents are available.
 */

import { Show } from "solid-js";
import { isStreaming } from "../../app/navigation";
import { store } from "../../app/store";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { effectiveAgent, setEffectiveAgent } from "./agent-selection";

export function AgentPicker() {
  return (
    <Show when={store.agents.length > 1}>
      <SegmentedControl
        label="Agent"
        options={store.agents}
        value={effectiveAgent()}
        optionValue={(agent) => agent.id}
        optionLabel={(agent) => agent.name}
        optionTitle={(agent) => agent.description}
        onChange={setEffectiveAgent}
        disabled={isStreaming()}
      />
    </Show>
  );
}
