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
import { CodeOutput } from "../../ui/CodeOutput";
import { Disclosure, DisclosureSummary } from "../../ui/Disclosure";
import { OutputSection } from "./renderers/shared";

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
    <Disclosure class="tool-block" open={isActive()}>
      <DisclosureSummary>
        <Settings size={14} /> {props.part.name}
        <Switch>
          <Match when={isActive()}>
            <span class="inline-flex items-center text-xs">
              {" "}
              <Loader size={14} class="animate-spin" />
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
      </DisclosureSummary>
      <CodeOutput compact class="border-t border-border px-3 py-1.5">
        {inputText()}
      </CodeOutput>
      <OutputSection state={props.part.state} />
    </Disclosure>
  );
}
