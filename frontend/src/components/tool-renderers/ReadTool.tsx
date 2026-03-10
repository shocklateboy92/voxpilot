import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import FileText from "lucide-solid/icons/file-text";
import type { JSX } from "solid-js";
import { OutputSection, StatusIcon, getTitle, inputString, isActive, stripProjectRoot } from "./shared";

export function ReadTool(props: { part: ToolPart }): JSX.Element {
  const filePath = () => {
    const title = getTitle(props.part.state);
    if (title) return title;
    const fp = inputString(props.part.state, "filePath");
    return fp ? stripProjectRoot(fp) : "read";
  };

  const range = () => {
    const offset = props.part.state.input.offset;
    const limit = props.part.state.input.limit;
    if (typeof offset === "number") {
      const end = typeof limit === "number" ? offset + limit : "…";
      return `:${offset}-${end}`;
    }
    return "";
  };

  return (
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <FileText size={14} />
        <span class="tool-summary-text">
          {filePath()}
          {range()}
        </span>
        <StatusIcon state={props.part.state} />
      </summary>
      <OutputSection state={props.part.state} />
    </details>
  );
}
