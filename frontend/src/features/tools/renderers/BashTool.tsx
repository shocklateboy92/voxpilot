import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import Terminal from "lucide-solid/icons/terminal";
import { createSignal, type JSX, Show } from "solid-js";
import { CodeOutput } from "../../../ui/CodeOutput";
import { Disclosure, DisclosureSummary } from "../../../ui/Disclosure";
import { backgroundToolStatus } from "../background-tools";
import { createLiveShellOutput } from "./live-shell-output";
import { inputString, isActive, OutputSection, ToolStatusIcon } from "./shared";

export function BashTool(props: { part: ToolPart }): JSX.Element {
  const command = () => inputString(props.part.state, "command");
  const description = () => inputString(props.part.state, "description");
  const workdir = () => inputString(props.part.state, "workdir");
  const status = () =>
    backgroundToolStatus(props.part) ?? props.part.state.status;
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
    <Disclosure
      class="tool-block"
      open={open()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <DisclosureSummary>
        <Terminal size={14} />
        <span class="min-w-0 flex-1 truncate">
          {command() || props.part.name}
        </span>
        <ToolStatusIcon status={status()} />
      </DisclosureSummary>
      <Show when={description()}>
        {(desc) => (
          <div class="border-t border-border px-3 py-1 text-xs text-muted italic">
            {desc()}
          </div>
        )}
      </Show>
      <Show when={workdir()}>
        {(dir) => (
          <div class="border-t border-border px-3 py-1 text-xs text-muted italic">
            {dir()}
          </div>
        )}
      </Show>
      <Show when={command()}>
        {(cmd) => (
          <CodeOutput compact class="border-t border-border px-3 py-1.5">
            {cmd()}
          </CodeOutput>
        )}
      </Show>
      <Show
        when={liveOutput.output()}
        fallback={<OutputSection state={props.part.state} />}
      >
        {(output) => (
          <div class="border-t border-border bg-bg px-3 py-1.5">
            <CodeOutput>{output()}</CodeOutput>
          </div>
        )}
      </Show>
      <Show when={liveOutput.unavailable() && active()}>
        <div
          role="status"
          class="border-t border-border px-3 py-2 text-xs text-muted"
        >
          Live output is unavailable on this server. Showing saved output.
        </div>
      </Show>
    </Disclosure>
  );
}
