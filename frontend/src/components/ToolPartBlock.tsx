/**
 * Unified tool part block — renders a tool call in any state:
 * streaming, running, completed, or error.
 */

import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import Check from "lucide-solid/icons/check";
import Loader from "lucide-solid/icons/loader";
import Settings from "lucide-solid/icons/settings";
import X from "lucide-solid/icons/x";
import { Match, Switch } from "solid-js";
import { OutputSection } from "./tool-renderers/shared";

interface Props {
  part: ToolPart;
}

export function ToolPartBlock(props: Props) {
  const inputText = () => {
    if (props.part.state.status === "streaming") return props.part.state.input;
    try {
      return JSON.stringify(props.part.state.input, null, 2);
    } catch {
      return String(props.part.state.input);
    }
  };

  const status = () => props.part.state.status;
  const isActive = () => status() === "streaming" || status() === "running";

  return (
    <details class="tool-block" open={isActive()}>
      <summary class="tool-summary">
        <Settings size={14} /> {props.part.name}
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
      <OutputSection state={props.part.state} />
    </details>
  );
}
