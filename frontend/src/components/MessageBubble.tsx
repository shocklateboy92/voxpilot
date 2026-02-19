/**
 * Renders a completed message from history.
 */

import { For, Show } from "solid-js";
import type { MessageRead, ToolCallInfo } from "../store";

interface Props {
  message: MessageRead;
}

export function MessageBubble(props: Props) {
  return (
    <>
      {/* For assistant messages with tool calls, render the tool blocks */}
      <Show when={props.message.role === "assistant" && props.message.tool_calls?.length}>
        <Show when={props.message.content}>
          <Show
            when={props.message.html}
            fallback={<div class="message assistant">{props.message.content}</div>}
          >
            <div class="message assistant markdown-body" innerHTML={props.message.html ?? undefined} />
          </Show>
        </Show>
        <For each={props.message.tool_calls}>
          {(tc) => <HistoryToolCall call={tc} />}
        </For>
      </Show>

      {/* For tool result messages, render inside matching block or standalone */}
      <Show when={props.message.role === "tool"}>
        <HistoryToolResult message={props.message} />
      </Show>

      {/* For regular user/assistant/system messages */}
      <Show
        when={
          !(props.message.role === "assistant" && props.message.tool_calls?.length) &&
          props.message.role !== "tool"
        }
      >
        <Show
          when={props.message.role === "assistant" && props.message.html}
          fallback={<div class={`message ${props.message.role}`}>{props.message.content}</div>}
        >
          <div class="message assistant markdown-body" innerHTML={props.message.html ?? undefined} />
        </Show>
      </Show>
    </>
  );
}

function HistoryToolCall(props: { call: ToolCallInfo }) {
  let argsText: string;
  try {
    argsText = JSON.stringify(JSON.parse(props.call.arguments), null, 2);
  } catch {
    argsText = props.call.arguments;
  }

  return (
    <details class="tool-block" data-tool-call-id={props.call.id}>
      <summary class="tool-summary">⚙ {props.call.name}</summary>
      <div class="tool-arguments">{argsText}</div>
    </details>
  );
}

function HistoryToolResult(props: { message: MessageRead }) {
  const isError = () => props.message.content.startsWith("Error:");

  return (
    <div class="tool-result-standalone">
      <div class={`tool-result${isError() ? " tool-error" : ""}`}>
        <pre>{props.message.content}</pre>
      </div>
    </div>
  );
}
