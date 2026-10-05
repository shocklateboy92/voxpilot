import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import Search from "lucide-solid/icons/search";
import { type JSX, Show } from "solid-js";
import { Disclosure, DisclosureSummary } from "../../../ui/Disclosure";
import { inputString, isActive, OutputSection, StatusIcon } from "./shared";

export function GrepTool(props: { part: ToolPart }): JSX.Element {
  const pattern = () => inputString(props.part.state, "pattern");

  const matches = () => {
    const s = props.part.state;
    if (
      s.status === "completed" &&
      s.metadata &&
      typeof s.metadata.matches === "number"
    ) {
      return s.metadata.matches;
    }
    return undefined;
  };

  return (
    <Disclosure class="tool-block" open={isActive(props.part.state)}>
      <DisclosureSummary>
        <Search size={14} />
        <span class="min-w-0 flex-1 truncate">
          {pattern() || "grep"}
          <Show when={matches() !== undefined}>
            {" — "}
            {matches()} match{matches() !== 1 ? "es" : ""}
          </Show>
        </span>
        <StatusIcon state={props.part.state} />
      </DisclosureSummary>
      <OutputSection state={props.part.state} />
    </Disclosure>
  );
}
