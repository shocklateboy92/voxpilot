import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import Pencil from "lucide-solid/icons/pencil";
import type { JSX } from "solid-js";
import {
  getTitle,
  inputString,
  isActive,
  OutputSection,
  StatusIcon,
  stripProjectRoot,
} from "./shared";

export function EditTool(props: { part: ToolPart }): JSX.Element {
  const filePath = () => {
    const title = getTitle(props.part.state);
    if (title) return title;
    const fp = inputString(props.part.state, "filePath");
    return fp ? stripProjectRoot(fp) : "edit";
  };

  return (
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <Pencil size={14} />
        <span class="tool-summary-text">{filePath()}</span>
        <StatusIcon state={props.part.state} />
      </summary>
      <OutputSection state={props.part.state} />
    </details>
  );
}
