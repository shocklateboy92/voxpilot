import type { SessionMessageAssistantTool as ToolPart } from "@opencode/client";
import ListChecks from "lucide-solid/icons/list-checks";
import { For, type JSX, Show } from "solid-js";
import { Disclosure, DisclosureSummary } from "../../../ui/Disclosure";
import { isActive, OutputSection, StatusIcon } from "./shared";

interface TodoItem {
  content: string;
  status: string;
  priority?: string;
}

function isTodoItem(item: unknown): item is TodoItem {
  if (typeof item !== "object" || item === null) return false;
  return (
    "content" in item &&
    typeof item.content === "string" &&
    "status" in item &&
    typeof item.status === "string"
  );
}

function parseTodos(input: { [key: string]: unknown }): TodoItem[] {
  const raw = input.todos;
  if (!Array.isArray(raw)) return [];
  const items: TodoItem[] = [];
  for (const item of raw) {
    if (isTodoItem(item)) {
      items.push({
        content: item.content,
        status: item.status,
        priority: typeof item.priority === "string" ? item.priority : undefined,
      });
    }
  }
  return items;
}

export function TodoTool(props: { part: ToolPart }): JSX.Element {
  const todos = () => {
    const state = props.part.state;
    return state.status === "streaming" ? [] : parseTodos(state.input);
  };

  const highlight = (): string => {
    const items = todos();
    if (items.length === 0) return "todos";

    const inProgress = items.find((t) => t.status === "in_progress");
    if (inProgress) return `→ ${inProgress.content}`;

    const allCompleted = items.every((t) => t.status === "completed");
    if (allCompleted) {
      const last = items[items.length - 1];
      return last ? `✓ ${last.content}` : "✓ done";
    }

    const firstPending = items.find((t) => t.status === "pending");
    if (firstPending) return `${items.length} items`;

    return `${items.length} items`;
  };

  const todoStatusIndicator = (status: string): string => {
    if (status === "completed") return "✓";
    if (status === "in_progress") return "→";
    return "○";
  };

  return (
    <Disclosure class="tool-block" open={isActive(props.part.state)}>
      <DisclosureSummary>
        <ListChecks size={14} />
        <span class="min-w-0 flex-1 truncate">{highlight()}</span>
        <StatusIcon state={props.part.state} />
      </DisclosureSummary>
      <Show when={todos().length > 0}>
        <div class="border-t border-border bg-bg px-3 py-1.5">
          <For each={todos()}>
            {(item) => (
              <div
                class="flex items-baseline gap-1.5 py-0.5 text-xs"
                classList={{
                  "text-muted line-through": item.status === "completed",
                  "text-accent": item.status === "in_progress",
                  "text-text":
                    item.status !== "completed" &&
                    item.status !== "in_progress",
                }}
              >
                <span class="w-5 shrink-0 text-center text-muted">
                  {todoStatusIndicator(item.status)}
                </span>
                <span>{item.content}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <OutputSection state={props.part.state} />
    </Disclosure>
  );
}
