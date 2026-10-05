import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import Pencil from "lucide-solid/icons/pencil";
import type { JSX } from "solid-js";
import { Disclosure, DisclosureSummary } from "../../../ui/Disclosure";
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
    const fp =
      inputString(props.part.state, "path") ||
      inputString(props.part.state, "filePath");
    return fp ? stripProjectRoot(fp) : "edit";
  };

  return (
    <Disclosure class="tool-block" open={isActive(props.part.state)}>
      <DisclosureSummary>
        <Pencil size={14} />
        <span class="min-w-0 flex-1 truncate">{filePath()}</span>
        <StatusIcon state={props.part.state} />
      </DisclosureSummary>
      <OutputSection state={props.part.state} />
    </Disclosure>
  );
}
