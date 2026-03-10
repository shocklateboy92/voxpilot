import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import FilePlus from "lucide-solid/icons/file-plus";
import type { JSX } from "solid-js";
import { OutputSection, StatusIcon, getTitle, inputString, isActive, stripProjectRoot } from "./shared";

export function WriteTool(props: { part: ToolPart }): JSX.Element {
  const filePath = () => {
    const title = getTitle(props.part.state);
    if (title) return title;
    const fp = inputString(props.part.state, "filePath");
    return fp ? stripProjectRoot(fp) : "write";
  };

  return (
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <FilePlus size={14} />
        <span class="tool-summary-text">{filePath()}</span>
        <StatusIcon state={props.part.state} />
      </summary>
      <OutputSection state={props.part.state} />
    </details>
  );
}
