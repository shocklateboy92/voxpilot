import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import MessageCircle from "lucide-solid/icons/message-circle";
import type { JSX } from "solid-js";
import { OutputSection, StatusIcon, getTitle, isActive } from "./shared";

export function QuestionTool(props: { part: ToolPart }): JSX.Element {
  const title = () => {
    const t = getTitle(props.part.state);
    return t || "question";
  };

  return (
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <MessageCircle size={14} />
        <span class="tool-summary-text">{title()}</span>
        <StatusIcon state={props.part.state} />
      </summary>
      <OutputSection state={props.part.state} />
    </details>
  );
}
