/**
 * Shared helpers for tool renderers — status icons, output sections,
 * path stripping, and safe input accessors.
 */

import type { SessionMessageAssistantTool } from "@opencode/client";
import Check from "lucide-solid/icons/check";
import Loader from "lucide-solid/icons/loader";
import X from "lucide-solid/icons/x";
import { For, type JSX, Show } from "solid-js";
import { activeSession } from "../../navigation";

type ToolState = SessionMessageAssistantTool["state"];

/** Whether the tool input is streaming or the tool is running. */
export function isActive(state: ToolState): boolean {
  return state.status === "streaming" || state.status === "running";
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
export function getOutput(state: ToolState): string | undefined {
  if (state.status === "completed" || state.status === "error") {
    const text = state.content
      ?.filter((content) => content.type === "text")
      .map((content) => content.text)
      .join("\n");
    return state.status === "error"
      ? [state.error.message, text].filter(Boolean).join("\n")
      : text;
  }
  return undefined;
}

/** Render the output/error section inside a tool block. */
export function OutputSection(props: { state: ToolState }): JSX.Element {
  const text = () => getOutput(props.state);
  const files = () => {
    const state = props.state;
    return state.status === "completed" || state.status === "error"
      ? (state.content?.filter((content) => content.type === "file") ?? [])
      : [];
  };
  return (
    <>
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
      <For each={files()}>
        {(file) => (
          <div class="tool-result">
            {file.name || "File attachment"} ({file.mime})
          </div>
        )}
      </For>
    </>
  );
}

/**
 * Strip the project root from an absolute path.
 * Uses the active session's directory if available, otherwise returns basename.
 */
export function stripProjectRoot(filePath: string): string {
  const session = activeSession();
  if (session) {
    const dir = session.location.directory;
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
 * Tool integrations may include a display title in their metadata.
 */
export function getTitle(state: ToolState): string | undefined {
  const title =
    state.status !== "streaming" ? state.metadata?.title : undefined;
  return typeof title === "string" ? title : undefined;
}

/**
 * Safely extract a string field from the tool input.
 */
export function inputString(state: ToolState, key: string): string {
  if (state.status === "streaming") return "";
  const val = state.input[key];
  return typeof val === "string" ? val : "";
}
