import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import Terminal from "lucide-solid/icons/terminal";
import { type JSX, Show } from "solid-js";
import { inputString, isActive, OutputSection, StatusIcon } from "./shared";

export function BashTool(props: { part: ToolPart }): JSX.Element {
  const command = () => inputString(props.part.state, "command");
  const description = () => inputString(props.part.state, "description");

  return (
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <Terminal size={14} />
        <span class="tool-summary-text">{command() || "bash"}</span>
        <StatusIcon state={props.part.state} />
      </summary>
      <Show when={description()}>
        {(desc) => <div class="tool-description">{desc()}</div>}
      </Show>
      <Show when={command()}>
        {(cmd) => <div class="tool-arguments">{cmd()}</div>}
      </Show>
      <OutputSection state={props.part.state} />
    </details>
  );
}
