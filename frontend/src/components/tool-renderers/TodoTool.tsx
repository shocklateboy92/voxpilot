import type { ToolPart } from "@opencode-ai/sdk/v2/client";
import ListChecks from "lucide-solid/icons/list-checks";
import { For, type JSX, Show } from "solid-js";
import { OutputSection, StatusIcon, isActive } from "./shared";

interface TodoItem {
  content: string;
  status: string;
  priority?: string;
}

function hasStringProp<K extends string>(
  obj: object,
  key: K,
): obj is object & Record<K, string> {
  return key in obj && typeof (obj as Record<string, unknown>)[key] === "string";
}

function isTodoItem(item: unknown): item is TodoItem {
  if (typeof item !== "object" || item === null) return false;
  return hasStringProp(item, "content") && hasStringProp(item, "status");
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
  const todos = () => parseTodos(props.part.state.input);

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
    <details class="tool-block" open={isActive(props.part.state)}>
      <summary class="tool-summary">
        <ListChecks size={14} />
        <span class="tool-summary-text">{highlight()}</span>
        <StatusIcon state={props.part.state} />
      </summary>
      <Show when={todos().length > 0}>
        <div class="tool-result">
          <For each={todos()}>
            {(item) => (
              <div
                class="tool-todo-item"
                classList={{
                  "todo-completed": item.status === "completed",
                  "todo-in-progress": item.status === "in_progress",
                }}
              >
                <span class="todo-status">
                  {todoStatusIndicator(item.status)}
                </span>
                <span>{item.content}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <OutputSection state={props.part.state} />
    </details>
  );
}
