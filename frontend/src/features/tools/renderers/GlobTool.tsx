import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import FolderSearch from "lucide-solid/icons/folder-search";
import { type JSX, Show } from "solid-js";
import { Disclosure, DisclosureSummary } from "../../../ui/Disclosure";
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
    <Disclosure class="tool-block" open={isActive(props.part.state)}>
      <DisclosureSummary>
        <FolderSearch size={14} />
        <span class="min-w-0 flex-1 truncate">
          {pattern() || "glob"}
          <Show when={count() !== undefined}>
            {" — "}
            {count()} file{count() !== 1 ? "s" : ""}
          </Show>
        </span>
        <StatusIcon state={props.part.state} />
      </DisclosureSummary>
      <OutputSection state={props.part.state} />
    </Disclosure>
  );
}
