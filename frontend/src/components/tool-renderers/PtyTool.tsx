import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import SquareTerminal from "lucide-solid/icons/square-terminal";
import type { JSX } from "solid-js";
import { isActive, OutputSection, StatusIcon } from "./shared";

export function PtyTool(props: { part: ToolPart }): JSX.Element {
  const summaryText = (): string => {
    const tool = props.part.tool;
    const input = props.part.state.input;

    if (tool === "pty_spawn") {
      const cmd = typeof input.command === "string" ? input.command : "";
      const args = Array.isArray(input.args)
        ? input.args.filter((a): a is string => typeof a === "string").join(" ")
        : "";
      return args ? `${cmd} ${args}` : cmd || "spawn";
    }

    if (tool === "pty_write") {
      const data = typeof input.data === "string" ? input.data : "";
      const preview = data.length > 60 ? `${data.slice(0, 60)}…` : data;
      return `input: ${preview}`;
    }

    if (tool === "pty_read") {
      const id = typeof input.id === "string" ? input.id : "";
      return `read session ${id}`;
    }

    if (tool === "pty_list") {
      return "list sessions";
    }

    if (tool === "pty_kill") {
      const id = typeof input.id === "string" ? input.id : "";
      return `kill session ${id}`;
    }

    return tool;
  };

  return (
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <SquareTerminal size={14} />
        <span class="tool-summary-text">{summaryText()}</span>
        <StatusIcon state={props.part.state} />
      </summary>
      <OutputSection state={props.part.state} />
    </details>
  );
}
