import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import Globe from "lucide-solid/icons/globe";
import type { JSX } from "solid-js";
import { Disclosure, DisclosureSummary } from "../../../ui/Disclosure";
import { inputString, isActive, OutputSection, StatusIcon } from "./shared";

export function WebFetchTool(props: { part: ToolPart }): JSX.Element {
  const hostname = () => {
    const url = inputString(props.part.state, "url");
    if (!url) return "webfetch";
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  return (
    <Disclosure class="tool-block" open={isActive(props.part.state)}>
      <DisclosureSummary>
        <Globe size={14} />
        <span class="min-w-0 flex-1 truncate">{hostname()}</span>
        <StatusIcon state={props.part.state} />
      </DisclosureSummary>
      <OutputSection state={props.part.state} />
    </Disclosure>
  );
}
