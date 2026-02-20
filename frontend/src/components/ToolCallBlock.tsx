/**
 * Tool call block — collapsible display for a tool invocation.
 *
 * Used for both in-flight streaming tool calls and history display.
 * When the tool result includes an artifact_id, renders a ChangesetCard.
 */

import { Show } from "solid-js";
import type { StreamingToolCall } from "../store";
import { artifacts } from "../store";
import { ChangesetCard } from "./ChangesetCard";

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

  const artifact = () => {
    const aid = props.call.artifactId;
    if (!aid) return undefined;
    return artifacts().get(aid);
  };

  return (
    <>
      <details class="tool-block" data-tool-call-id={props.call.id}>
        <summary class="tool-summary">
          ⚙ {props.call.name}
          <Show when={props.call.result === undefined}>
            <span class="tool-spinner"> ⏳</span>
          </Show>
        </summary>
        <div class="tool-arguments">{argsText()}</div>
        <Show when={props.call.result !== undefined && !artifact()}>
          <div class={`tool-result${props.call.isError ? " tool-error" : ""}`}>
            <pre>{props.call.result}</pre>
          </div>
        </Show>
      </details>
      <Show when={artifact()}>
        {(a) => <ChangesetCard artifact={a()} />}
      </Show>
    </>
  );
}
