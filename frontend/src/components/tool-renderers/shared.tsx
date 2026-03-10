/**
 * Shared helpers for tool renderers — status icons, output sections,
 * path stripping, and safe input accessors.
 */

import type { ToolState } from "@opencode-ai/sdk/v2/client";
import Check from "lucide-solid/icons/check";
import Loader from "lucide-solid/icons/loader";
import X from "lucide-solid/icons/x";
import { type JSX, Show } from "solid-js";
import { activeSession } from "../../navigation";

/** Whether the tool is still pending or running (details should be open). */
export function isActive(state: ToolState): boolean {
  return state.status === "pending" || state.status === "running";
}

/** Status icon: spinning loader for active, check for completed, X for error. */
export function StatusIcon(props: { state: ToolState }): JSX.Element {
  return (
    <>
      <Show when={isActive(props.state)}>
        <span class="tool-spinner">
          <Loader size={14} class="icon-spin" />
        </span>
      </Show>
      <Show when={props.state.status === "completed"}>
        <Check size={14} />
      </Show>
      <Show when={props.state.status === "error"}>
        <X size={14} />
      </Show>
    </>
  );
}

/** Extract the output text (completed) or error text from a tool state. */
function getOutput(state: ToolState): string | undefined {
  if (state.status === "completed") return state.output;
  if (state.status === "error") return state.error;
  return undefined;
}

/** Render the output/error section inside a tool block. */
export function OutputSection(props: { state: ToolState }): JSX.Element {
  const text = () => getOutput(props.state);
  return (
    <Show when={text()}>
      {(t) => (
        <div
          class="tool-result"
          classList={{ "tool-error": props.state.status === "error" }}
        >
          <pre>{t()}</pre>
        </div>
      )}
    </Show>
  );
}

/**
 * Strip the project root from an absolute path.
 * Uses the active session's directory if available, otherwise returns basename.
 */
export function stripProjectRoot(filePath: string): string {
  const session = activeSession();
  if (session) {
    const dir = session.directory;
    if (dir && filePath.startsWith(dir)) {
      // Strip directory + trailing slash
      const relative = filePath.slice(dir.length);
      if (relative.startsWith("/")) return relative.slice(1);
      return relative;
    }
  }
  // Fallback: return everything after the last slash
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
}

/**
 * Get the title from the state — available on running, completed states.
 * Returns undefined for pending/error states that don't have it.
 */
export function getTitle(state: ToolState): string | undefined {
  if (state.status === "running" || state.status === "completed") {
    return state.title;
  }
  return undefined;
}

/**
 * Safely extract a string field from the tool input.
 */
export function inputString(state: ToolState, key: string): string {
  const val = state.input[key];
  return typeof val === "string" ? val : "";
}
