/**
 * Tool call block — collapsible display for a tool invocation.
 *
 * Used for both in-flight streaming tool calls and history display.
 */

import type { StreamingToolCall } from "../store";

interface Props {
  call: StreamingToolCall;
}

export function ToolCallBlock(props: Props) {
  const argsText = () => {
    try {
      return JSON.stringify(JSON.parse(props.call.arguments), null, 2);
    } catch {
      return props.call.arguments;
    }
  };

  return (
    <details class="tool-block" data-tool-call-id={props.call.id}>
      <summary class="tool-summary">
        ⚙ {props.call.name}
        {props.call.result === undefined && <span class="tool-spinner"> ⏳</span>}
      </summary>
      <div class="tool-arguments">{argsText()}</div>
      {props.call.result !== undefined && (
        <div class={`tool-result${props.call.isError ? " tool-error" : ""}`}>
          <pre>{props.call.result}</pre>
        </div>
      )}
    </details>
  );
}
