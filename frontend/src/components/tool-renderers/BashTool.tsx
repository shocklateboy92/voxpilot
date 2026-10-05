import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import Terminal from "lucide-solid/icons/terminal";
import { createSignal, type JSX, Show } from "solid-js";
import { backgroundToolStatus } from "../../background-tools";
import { createLiveShellOutput } from "./live-shell-output";
import {
  inputString,
  isActive,
  OutputSection,
  ToolStatusIcon,
} from "./shared";

export function BashTool(props: { part: ToolPart }): JSX.Element {
  const command = () => inputString(props.part.state, "command");
  const description = () => inputString(props.part.state, "description");
  const workdir = () => inputString(props.part.state, "workdir");
  const status = () => backgroundToolStatus(props.part) ?? props.part.state.status;
  const active = () => status() === "running" || isActive(props.part.state);
  const [open, setOpen] = createSignal(active());
  const shellID = () => {
    const state = props.part.state;
    if (state.status === "streaming") return undefined;
    const value = state.metadata?.shellID;
    return typeof value === "string" ? value : undefined;
  };
  const liveOutput = createLiveShellOutput({
    open,
    running: active,
    shellID,
  });

  return (
    <details
      class="tool-block"
      open={open()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary class="tool-summary">
        <Terminal size={14} />
        <span class="tool-summary-text">{command() || props.part.name}</span>
        <ToolStatusIcon status={status()} />
      </summary>
      <Show when={description()}>
        {(desc) => <div class="tool-description">{desc()}</div>}
      </Show>
      <Show when={workdir()}>
        {(dir) => <div class="tool-description">{dir()}</div>}
      </Show>
      <Show when={command()}>
        {(cmd) => <div class="tool-arguments">{cmd()}</div>}
      </Show>
      <Show
        when={liveOutput()}
        fallback={<OutputSection state={props.part.state} />}
      >
        {(output) => (
          <div class="tool-result">
            <pre>{output()}</pre>
          </div>
        )}
      </Show>
    </details>
  );
}
