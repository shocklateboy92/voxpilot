/**
 * Copilot streaming output block.
 *
 * Renders streaming Copilot output inside a <details> element.
 * Expanded while running, auto-collapses on completion.
 */

import { createEffect } from "solid-js";
import type { StreamingToolCall } from "../store";

interface Props {
  call: StreamingToolCall;
}

export function CopilotStreamBlock(props: Props) {
  let preRef: HTMLPreElement | undefined;

  // Auto-scroll to bottom as content streams in
  createEffect(() => {
    // Access copilotStream to subscribe to changes
    void props.call.copilotStream;
    if (preRef) {
      preRef.scrollTop = preRef.scrollHeight;
    }
  });

  const sessionLabel = () => props.call.copilotSessionName ?? "copilot";
  const isDone = () => props.call.copilotDone === true;

  return (
    <details class="copilot-block" open={!isDone()}>
      <summary class="copilot-summary">
        🤖 Copilot [{sessionLabel()}]
        {isDone()
          ? <span class="copilot-done-label"> — done</span>
          : <span class="copilot-spinner"> ⏳</span>
        }
        {isDone() && props.call.copilotSummary && (
          <span class="copilot-done-label"> — {props.call.copilotSummary}</span>
        )}
      </summary>
      <pre class="copilot-stream" ref={preRef}>
        {props.call.copilotStream ?? ""}
      </pre>
    </details>
  );
}
