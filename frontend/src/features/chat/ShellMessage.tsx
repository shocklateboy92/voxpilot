import type { SessionMessageShell } from "@opencode/client";
import { createSignal, Show } from "solid-js";
import { CodeOutput } from "../../ui/CodeOutput";
import { Disclosure, DisclosureSummary } from "../../ui/Disclosure";
import { createLiveShellOutput } from "../tools/renderers/live-shell-output";

/** User-run !commands use the same live shell API as assistant tool calls. */
export function ShellMessage(props: { message: SessionMessageShell }) {
  const running = () => props.message.status === "running";
  const [open, setOpen] = createSignal(running());
  const live = createLiveShellOutput({
    open,
    running,
    shellID: () => props.message.shellID,
  });
  return (
    <Disclosure
      class="tool-block"
      open={open()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <DisclosureSummary>
        {props.message.command} ({props.message.status})
      </DisclosureSummary>
      <div class="border-t border-border bg-bg px-3 py-1.5">
        <CodeOutput>{live.output() ?? props.message.output?.output}</CodeOutput>
      </div>
      <Show when={live.unavailable() && running()}>
        <div
          role="status"
          class="border-t border-border px-3 py-2 text-xs text-muted"
        >
          Live output is unavailable on this server.
          <Show when={props.message.output?.output}>
            {" "}
            Showing saved output.
          </Show>
        </div>
      </Show>
    </Disclosure>
  );
}
