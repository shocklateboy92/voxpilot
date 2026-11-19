import { For } from "solid-js";
import type { ReviewFile } from "./review-navigation";

export function ChangedFileList(props: {
  files: readonly ReviewFile[];
  currentPath?: string;
  onSelect: (file: ReviewFile, index: number) => void;
  class?: string;
  listRef?: (element: HTMLUListElement) => void;
}) {
  return (
    <ul
      aria-label="Changed files"
      ref={(element) => props.listRef?.(element)}
      class="m-0 list-none"
      classList={{ [props.class ?? ""]: Boolean(props.class) }}
    >
      <For each={props.files}>
        {(file, index) => {
          const current = () => file.filePath === props.currentPath;
          return (
            <li>
              <button
                type="button"
                aria-current={current() ? "true" : undefined}
                class="changeset-file-row flex min-h-11 w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-subtle-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                classList={{
                  "bg-subtle-bg font-semibold text-accent": current(),
                }}
                onClick={() => props.onSelect(file, index())}
              >
                <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {file.filePath}
                </span>
                <span class="shrink-0 whitespace-nowrap">
                  <span class="text-ok">+{file.additions}</span>{" "}
                  <span class="text-error">-{file.deletions}</span>
                </span>
              </button>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
