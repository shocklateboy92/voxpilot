/**
 * Renders a completed message from history.
 */

import { For, Show } from "solid-js"
import type { MessageWithParts } from "../store"
import type { TextPart, ToolPart } from "@opencode-ai/sdk/client"
import { renderMarkdown } from "../markdown"

interface Props {
  msg: MessageWithParts
}

export function MessageBubble(props: Props) {
  const textContent = () =>
    props.msg.parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join("")

  const toolParts = () =>
    props.msg.parts.filter((p): p is ToolPart => p.type === "tool")

  const role = () => props.msg.info.role

  return (
    <div class={`message ${role()}`}>
      <Show when={role() === "assistant" && textContent()}>
        <div class="markdown-body" innerHTML={renderMarkdown(textContent())} />
      </Show>
      <Show when={role() === "user" && textContent()}>
        <p>{textContent()}</p>
      </Show>
      <For each={toolParts()}>
        {(part) => <ToolPartBlock part={part} />}
      </For>
    </div>
  )
}

function ToolPartBlock(props: { part: ToolPart }) {
  const inputText = () => {
    try {
      return JSON.stringify(props.part.state.input, null, 2)
    } catch {
      return String(props.part.state.input)
    }
  }

  const isCompleted = () => props.part.state.status === "completed"
  const isError = () => props.part.state.status === "error"
  const isRunning = () => props.part.state.status === "running"

  const output = () => {
    const s = props.part.state
    if (s.status === "completed") return s.output
    if (s.status === "error") return s.error
    return undefined
  }

  return (
    <details class="tool-block" open={isRunning()}>
      <summary class="tool-summary">
        ⚙ {props.part.tool}
        {isRunning() && <span class="tool-spinner"> ⏳</span>}
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
  )
}
