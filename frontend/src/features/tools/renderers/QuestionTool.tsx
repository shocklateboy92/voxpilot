import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import MessageCircle from "lucide-solid/icons/message-circle";
import type { JSX } from "solid-js";
import { Disclosure, DisclosureSummary } from "../../../ui/Disclosure";
import { getTitle, isActive, OutputSection, StatusIcon } from "./shared";

export function QuestionTool(props: { part: ToolPart }): JSX.Element {
  const title = () => {
    const t = getTitle(props.part.state);
    return t || "question";
  };

  return (
    <Disclosure class="tool-block" open={isActive(props.part.state)}>
      <DisclosureSummary>
        <MessageCircle size={14} />
        <span class="min-w-0 flex-1 truncate">{title()}</span>
        <StatusIcon state={props.part.state} />
      </DisclosureSummary>
      <OutputSection state={props.part.state} />
    </Disclosure>
  );
}
