/**
 * ToolCallRenderer — dispatches to the appropriate specialized
 * renderer based on the tool name, falling back to the generic
 * ToolPartBlock for unknown tools.
 */

import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import { type Component, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { ChangesetCard } from "./ChangesetCard";
import { ToolPartBlock } from "./ToolPartBlock";
import {
  BashTool,
  EditTool,
  GlobTool,
  GrepTool,
  PtyTool,
  QuestionTool,
  ReadTool,
  TaskTool,
  TodoTool,
  WebFetchTool,
  WriteTool,
} from "./tool-renderers/index";

interface Props {
  part: ToolPart;
}

const renderers: Record<string, Component<Props>> = {
  read: ReadTool,
  edit: EditTool,
  write: WriteTool,
  bash: BashTool,
  glob: GlobTool,
  grep: GrepTool,
  task: TaskTool,
  todowrite: TodoTool,
  question: QuestionTool,
  webfetch: WebFetchTool,
  pty_spawn: PtyTool,
  pty_write: PtyTool,
  pty_read: PtyTool,
  pty_list: PtyTool,
  pty_kill: PtyTool,
  voxpilot_show_diff: ChangesetCard,
};

export function ToolCallRenderer(props: Props): JSX.Element {
  const Renderer = () => renderers[props.part.tool];

  return (
    <Show when={Renderer()} fallback={<ToolPartBlock part={props.part} />}>
      {(R) => <Dynamic component={R()} part={props.part} />}
    </Show>
  );
}
