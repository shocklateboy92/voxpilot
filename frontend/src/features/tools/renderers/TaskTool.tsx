import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import Bot from "lucide-solid/icons/bot";
import { type JSX, Show } from "solid-js";
import { Badge } from "../../../ui/Badge";
import { Disclosure, DisclosureSummary } from "../../../ui/Disclosure";
import { backgroundToolStatus } from "../background-tools";
import { inputString, isActive, OutputSection, ToolStatusIcon } from "./shared";

export function TaskTool(props: { part: ToolPart }): JSX.Element {
  const description = () => inputString(props.part.state, "description");
  const subagentType = () =>
    inputString(props.part.state, "agent") ||
    inputString(props.part.state, "subagent_type");
  const status = () =>
    backgroundToolStatus(props.part) ?? props.part.state.status;
  const active = () => status() === "running" || isActive(props.part.state);

  return (
    <Disclosure class="tool-block" open={active()}>
      <DisclosureSummary>
        <Bot size={14} />
        <span class="min-w-0 flex-1 truncate">
          {description() || props.part.name}
        </span>
        <Show when={subagentType()}>{(t) => <Badge>{t()}</Badge>}</Show>
        <ToolStatusIcon status={status()} />
      </DisclosureSummary>
      <OutputSection state={props.part.state} />
    </Disclosure>
  );
}
