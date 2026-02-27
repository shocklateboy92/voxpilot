/**
 * Unified tool part block — renders a tool call in any state:
 * pending, running, completed, or error.
 */

import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import { Check, Loader, Settings, X } from "lucide-solid";
import { Match, Show, Switch } from "solid-js";

interface Props {
  part: ToolPart;
}

export function ToolPartBlock(props: Props) {
  const inputText = () => {
    try {
      return JSON.stringify(props.part.state.input, null, 2);
    } catch {
      return String(props.part.state.input);
    }
  };

  const status = () => props.part.state.status;
  const isActive = () => status() === "pending" || status() === "running";

  const output = () => {
    const s = props.part.state;
    if (s.status === "completed") return s.output;
    if (s.status === "error") return s.error;
    return undefined;
  };

  return (
    <details class="tool-block" open={isActive()}>
      <summary class="tool-summary">
        <Settings size={14} /> {props.part.tool}
        <Switch>
          <Match when={isActive()}>
            <span class="tool-spinner">
              {" "}
              <Loader size={14} class="icon-spin" />
            </span>
          </Match>
          <Match when={status() === "completed"}>
            {" "}
            <Check size={14} />
          </Match>
          <Match when={status() === "error"}>
            {" "}
            <X size={14} />
          </Match>
        </Switch>
      </summary>
      <div class="tool-arguments">{inputText()}</div>
      <Show when={output()}>
        {(text) => (
          <div
            class="tool-result"
            classList={{ "tool-error": status() === "error" }}
          >
            <pre>{text()}</pre>
          </div>
        )}
      </Show>
    </details>
  );
}
