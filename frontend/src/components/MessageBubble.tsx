/**
 * Renders a message — both completed history and in-progress streaming.
 *
 * A message is considered "streaming" when it is an assistant message
 * whose `time.completed` is not yet set.
 */

import type { TextPart, ToolPart } from "@opencode-ai/sdk/v2/client";
import { For, Show } from "solid-js";
import { renderMarkdown } from "../markdown";
import type { MessageWithParts } from "../store";
import { ToolPartBlock } from "./ToolPartBlock";

interface Props {
  msg: MessageWithParts;
}

export function MessageBubble(props: Props) {
  const textContent = () =>
    props.msg.parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join("");

  const toolParts = () =>
    props.msg.parts.filter((p): p is ToolPart => p.type === "tool");

  const role = () => props.msg.info.role;

  /** Whether this message is still being streamed (assistant, not yet completed). */
  const isInProgress = () => {
    const info = props.msg.info;
    if (info.role !== "assistant") return false;
    return !("time" in info && info.time.completed);
  };

  return (
    <div
      class="message"
      classList={{
        user: role() === "user",
        assistant: role() === "assistant",
        streaming: isInProgress() && !!textContent(),
      }}
    >
      <Show when={role() === "assistant" && textContent()}>
        <div class="markdown-body" innerHTML={renderMarkdown(textContent())} />
      </Show>
      <Show when={role() === "user" && textContent()}>
        <p>{textContent()}</p>
      </Show>
      <For each={toolParts()}>{(part) => <ToolPartBlock part={part} />}</For>
    </div>
  );
}
