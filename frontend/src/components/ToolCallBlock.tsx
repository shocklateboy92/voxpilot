/**
 * Tool call block for streaming tool parts.
 */

import type { ToolPart } from "@opencode-ai/sdk/client";
import { Show } from "solid-js";

interface Props {
  part: ToolPart;
}

export function ToolCallBlock(props: Props) {
  const inputText = () => {
    try {
      return JSON.stringify(props.part.state.input, null, 2);
    } catch {
      return String(props.part.state.input);
    }
  };

  const isRunning = () =>
    props.part.state.status === "running" ||
    props.part.state.status === "pending";
  const isError = () => props.part.state.status === "error";

  const output = () => {
    const s = props.part.state;
    if (s.status === "completed") return s.output;
    if (s.status === "error") return s.error;
    return undefined;
  };

  return (
    <details class="tool-block" open={isRunning()}>
      <summary class="tool-summary">
        ⚙ {props.part.tool}
        {isRunning() && <span class="tool-spinner"> ⏳</span>}
      </summary>
      <div class="tool-arguments">{inputText()}</div>
      <Show when={output()}>
        {(text) => (
          <div class={`tool-result${isError() ? " tool-error" : ""}`}>
            <pre>{text()}</pre>
          </div>
        )}
      </Show>
    </details>
  );
}
