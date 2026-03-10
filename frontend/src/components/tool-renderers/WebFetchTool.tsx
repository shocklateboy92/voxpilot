import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import Globe from "lucide-solid/icons/globe";
import type { JSX } from "solid-js";
import { OutputSection, StatusIcon, inputString, isActive } from "./shared";

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
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <Globe size={14} />
        <span class="tool-summary-text">{hostname()}</span>
        <StatusIcon state={props.part.state} />
      </summary>
      <OutputSection state={props.part.state} />
    </details>
  );
}
