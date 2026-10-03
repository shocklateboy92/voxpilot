import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import Bot from "lucide-solid/icons/bot";
import { type JSX, Show } from "solid-js";
import { inputString, isActive, OutputSection, StatusIcon } from "./shared";

export function TaskTool(props: { part: ToolPart }): JSX.Element {
  const description = () => inputString(props.part.state, "description");
  const subagentType = () =>
    inputString(props.part.state, "agent") ||
    inputString(props.part.state, "subagent_type");

  return (
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <Bot size={14} />
        <span class="tool-summary-text">
          {description() || props.part.name}
        </span>
        <Show when={subagentType()}>
          {(t) => <span class="tool-badge">{t()}</span>}
        </Show>
        <StatusIcon state={props.part.state} />
      </summary>
      <OutputSection state={props.part.state} />
    </details>
  );
}
