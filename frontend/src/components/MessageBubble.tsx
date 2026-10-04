/**
 * Renders a message — both completed history and in-progress streaming.
 *
 * A message is considered "streaming" when it is an assistant message
 * whose `time.completed` is not yet set.
 */

import type { SessionMessageInfo } from "@opencode/client";
import { For, Show } from "solid-js";
import { backgroundCompletion } from "../background-tools";
import { renderMarkdown } from "../markdown";
import { formatVariantLabel, resolveModelName } from "../model-utils";
import { store } from "../store";
import { ToolCallRenderer } from "./ToolCallRenderer";

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
  msg: SessionMessageInfo;
}

export function MessageBubble(props: Props) {
  const textContent = () => {
    const msg = props.msg;
    if (
      msg.type === "user" ||
      msg.type === "synthetic" ||
      msg.type === "system" ||
      msg.type === "skill"
    )
      return msg.text;
    if (msg.type !== "assistant") return "";
    return msg.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  };

  const toolParts = () =>
    props.msg.type === "assistant"
      ? props.msg.content.filter((part) => part.type === "tool")
      : [];

  const role = () => props.msg.type;

  /** The agent name that produced this assistant message, if available. */
  const agentName = () => {
    const info = props.msg;
    if (info.type !== "assistant") return undefined;
    return info.agent;
  };

  /** Resolve the agent's configured color (from the SDK), if available. */
  const agentColor = () => {
    const name = agentName();
    if (!name) return undefined;
    return store.agents.find((a) => a.id === name)?.color;
  };

  /** The model ID that produced this assistant message, if available. */
  const modelID = () => {
    const info = props.msg;
    if (info.type !== "assistant") return undefined;
    return info.model.id;
  };

  /** The provider ID for this assistant message, if available. */
  const providerID = () => {
    const info = props.msg;
    if (info.type !== "assistant") return undefined;
    return info.model.providerID;
  };

  /** Resolved display name for the model (falls back to raw modelID). */
  const modelDisplayName = () => {
    const pid = providerID();
    const mid = modelID();
    if (!pid || !mid) return mid;
    return resolveModelName(pid, mid);
  };

  /** The selected model variant/thinking level, if available. */
  const modelVariant = () => {
    const info = props.msg;
    if (info.type !== "assistant") return undefined;
    return info.model.variant;
  };

  /** Whether this message is still being streamed (assistant, not yet completed). */
  const isInProgress = () => {
    const info = props.msg;
    if (info.type !== "assistant") return false;
    return info.time.completed === undefined;
  };

  return (
    <Show
      when={
        !backgroundCompletion(props.msg) &&
        (textContent() || role() === "assistant" || role() === "shell")
      }
    >
        <div
        class="message"
        classList={{
          user: role() === "user",
          assistant: role() !== "user",
          streaming: isInProgress() && !!textContent(),
        }}
      >
        <Show
          when={
            role() === "assistant" &&
            (agentName() || modelID() || modelVariant())
          }
        >
          <div class="message-meta">
            <Show when={agentName()}>
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
                {store.agents.find((agent) => agent.id === agentName())?.name ??
                  agentName()}
              </span>
            </Show>
            <Show when={modelID()}>
              <span class="model-badge">
                {modelDisplayName()}
                <Show when={modelVariant()}>
                  {(variant) => <>{` · ${formatVariantLabel(variant())}`}</>}
                </Show>
              </span>
            </Show>
          </div>
        </Show>
        <Show when={role() !== "user" && textContent()}>
          <div
            class="markdown-body"
            ref={guardScrollWrappers}
            // eslint-disable-next-line solid/no-innerhtml -- intentional: markdown renderer produces trusted HTML
            innerHTML={renderMarkdown(textContent())}
          />
        </Show>
        <Show when={role() === "user" && textContent()}>
          <p>{textContent()}</p>
        </Show>
        <Show when={props.msg.type === "shell" && props.msg}>
          {(shell) => (
            <details class="tool-block" open={shell().status === "running"}>
              <summary class="tool-summary">
                {shell().command} ({shell().status})
              </summary>
              <div class="tool-result">
                <pre>{shell().output?.output}</pre>
              </div>
            </details>
          )}
        </Show>
        <For each={toolParts()}>
          {(part) => <ToolCallRenderer part={part} />}
        </For>
        </div>
    </Show>
  );
}
