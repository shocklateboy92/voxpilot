import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import Search from "lucide-solid/icons/search";
import { type JSX, Show } from "solid-js";
import { OutputSection, StatusIcon, inputString, isActive } from "./shared";

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
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <Search size={14} />
        <span class="tool-summary-text">
          {pattern() || "grep"}
          <Show when={matches() !== undefined}>
            {" — "}
            {matches()} match{matches() !== 1 ? "es" : ""}
          </Show>
        </span>
        <StatusIcon state={props.part.state} />
      </summary>
      <OutputSection state={props.part.state} />
    </details>
  );
}
