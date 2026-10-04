import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import Bot from "lucide-solid/icons/bot";
import { type JSX, Show } from "solid-js";
import { backgroundToolStatus } from "../../background-tools";
import {
  inputString,
  isActive,
  OutputSection,
  ToolStatusIcon,
} from "./shared";

export function TaskTool(props: { part: ToolPart }): JSX.Element {
  const description = () => inputString(props.part.state, "description");
  const subagentType = () =>
    inputString(props.part.state, "agent") ||
    inputString(props.part.state, "subagent_type");
  const status = () => backgroundToolStatus(props.part) ?? props.part.state.status;
  const active = () => status() === "running" || isActive(props.part.state);

  return (
    <details class="tool-block" open={active()}>
      <summary class="tool-summary">
        <Bot size={14} />
        <span class="tool-summary-text">
          {description() || props.part.name}
        </span>
        <Show when={subagentType()}>
          {(t) => <span class="tool-badge">{t()}</span>}
        </Show>
        <ToolStatusIcon status={status()} />
      </summary>
      <OutputSection state={props.part.state} />
    </details>
  );
}
