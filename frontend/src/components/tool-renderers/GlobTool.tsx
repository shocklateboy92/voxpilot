import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import FolderSearch from "lucide-solid/icons/folder-search";
import { type JSX, Show } from "solid-js";
import { inputString, isActive, OutputSection, StatusIcon } from "./shared";

export function GlobTool(props: { part: ToolPart }): JSX.Element {
  const pattern = () => inputString(props.part.state, "pattern");

  const count = () => {
    const s = props.part.state;
    if (
      s.status === "completed" &&
      s.metadata &&
      typeof s.metadata.count === "number"
    ) {
      return s.metadata.count;
    }
    return undefined;
  };

  return (
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <FolderSearch size={14} />
        <span class="tool-summary-text">
          {pattern() || "glob"}
          <Show when={count() !== undefined}>
            {" — "}
            {count()} file{count() !== 1 ? "s" : ""}
          </Show>
        </span>
        <StatusIcon state={props.part.state} />
      </summary>
      <OutputSection state={props.part.state} />
    </details>
  );
}
