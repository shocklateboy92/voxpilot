/**
 * Unified tool part block — renders a tool call in any state:
 * pending, running, completed, or error.
 */

import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import { Show } from "solid-js";

interface Props {
  part: ToolPart;
}

export function ToolPartBlock(props: Props) {
  const inputText = () => {
    try {
      return JSON.stringify(props.part.state.input, null, 2);
    } catch {
      return String(props.part.state.input);
    }
  };

  const isPending = () => props.part.state.status === "pending";
  const isRunning = () => props.part.state.status === "running";
  const isCompleted = () => props.part.state.status === "completed";
  const isError = () => props.part.state.status === "error";
  const isActive = () => isPending() || isRunning();

  const output = () => {
    const s = props.part.state;
    if (s.status === "completed") return s.output;
    if (s.status === "error") return s.error;
    return undefined;
  };

  return (
    <details class="tool-block" open={isActive()}>
      <summary class="tool-summary">
        ⚙ {props.part.tool}
        {isActive() && <span class="tool-spinner"> ⏳</span>}
        {isCompleted() && " ✓"}
        {isError() && " ✗"}
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
