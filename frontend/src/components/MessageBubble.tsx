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
import { agents } from "../store";
import { ChangesetCard } from "./ChangesetCard";
import { ToolPartBlock } from "./ToolPartBlock";

/**
 * Attach a touchstart listener that stops propagation when the touch
 * originates inside a `.scroll-wrapper`.  This prevents the parent
 * swipe-navigation handler from hijacking horizontal scrolls inside
 * code blocks and tables.
 */
function guardScrollWrappers(el: HTMLElement): void {
  el.addEventListener(
    "touchstart",
    (e: TouchEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest(".scroll-wrapper")) {
        e.stopPropagation();
      }
    },
    { passive: true },
  );
}

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

  /** The agent name that produced this assistant message, if available. */
  const agentName = () => {
    const info = props.msg.info;
    if (info.role !== "assistant") return undefined;
    return info.agent;
  };

  /** Resolve the agent's configured color (from the SDK), if available. */
  const agentColor = () => {
    const name = agentName();
    if (!name) return undefined;
    return agents().find((a) => a.name === name)?.color;
  };

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
      <Show when={role() === "assistant" && agentName()}>
        <span
          class="agent-badge"
          style={
            agentColor()
              ? {
                  background: `${agentColor()}20`,
                  color: agentColor(),
                  border: `1px solid ${agentColor()}40`,
                }
              : undefined
          }
        >
          {agentName()}
        </span>
      </Show>
      <Show when={role() === "assistant" && textContent()}>
        {/* eslint-disable-next-line solid/no-innerhtml -- intentional: markdown renderer produces trusted HTML */}
        <div class="markdown-body" ref={guardScrollWrappers} innerHTML={renderMarkdown(textContent())} />
      </Show>
      <Show when={role() === "user" && textContent()}>
        <p>{textContent()}</p>
      </Show>
      <For each={toolParts()}>
        {(part) =>
          part.tool === "voxpilot_show_diff" ? (
            <ChangesetCard part={part} />
          ) : (
            <ToolPartBlock part={part} />
          )
        }
      </For>
    </div>
  );
}
