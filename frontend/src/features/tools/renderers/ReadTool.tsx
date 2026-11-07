import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import FileText from "lucide-solid/icons/file-text";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { activeSession } from "../../../app/navigation";
import { openMarkdown } from "../../../app/routing";
import { Button } from "../../../ui/Button";
import { Disclosure, DisclosureSummary } from "../../../ui/Disclosure";
import { isMarkdownPath } from "../../files/file-state";
import {
  getTitle,
  inputString,
  isActive,
  OutputSection,
  StatusIcon,
  stripProjectRoot,
} from "./shared";

export function ReadTool(props: { part: ToolPart }): JSX.Element {
  const sourcePath = () =>
    inputString(props.part.state, "path") ||
    inputString(props.part.state, "filePath");
  const filePath = () => {
    const title = getTitle(props.part.state);
    if (title) return title;
    const fp =
      inputString(props.part.state, "path") ||
      inputString(props.part.state, "filePath");
    return fp ? stripProjectRoot(fp) : "read";
  };

  const range = () => {
    const state = props.part.state;
    if (state.status === "streaming") return "";
    const offset = state.input.offset;
    const limit = state.input.limit;
    if (typeof offset === "number") {
      const end = typeof limit === "number" ? offset + limit - 1 : "…";
      return `:${offset}-${end}`;
    }
    return "";
  };

  return (
    <Disclosure class="tool-block" open={isActive(props.part.state)}>
      <DisclosureSummary>
        <FileText size={14} />
        <span class="min-w-0 flex-1 truncate">
          {filePath()}
          {range()}
        </span>
        <StatusIcon state={props.part.state} />
      </DisclosureSummary>
      <Show
        when={
          isMarkdownPath(sourcePath()) && activeSession()?.location.directory
        }
      >
        {(directory) => (
          <div class="px-3 py-2">
            <Button
              size="sm"
              onClick={() => openMarkdown(sourcePath(), directory())}
            >
              View Markdown
            </Button>
          </div>
        )}
      </Show>
      <OutputSection state={props.part.state} />
    </Disclosure>
  );
}
