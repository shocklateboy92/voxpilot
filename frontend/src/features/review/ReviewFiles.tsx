import { For, onMount } from "solid-js";
import { Button } from "../../ui/Button";
import { Overlay } from "../../ui/Overlay";
import { OverlayHeader } from "../../ui/OverlayHeader";
import { type reviewFile, selectReviewFile } from "./review-navigation";

export function ReviewFiles(props: {
  review: NonNullable<ReturnType<typeof reviewFile>>;
  onClose: () => void;
  onChangeComparison: () => void;
}) {
  let list: HTMLUListElement | undefined;
  onMount(() => {
    list
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest" });
  });

  return (
    <Overlay label="Changed files" onClose={props.onClose}>
      <OverlayHeader title="Changed files" onClose={props.onClose} />
      <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <span class="min-w-0 font-mono text-xs text-muted [overflow-wrap:anywhere]">
          {props.review.comparison}
        </span>
        <Button size="sm" onClick={props.onChangeComparison}>
          Change comparison
        </Button>
      </div>
      <ul
        ref={list}
        class="min-h-0 list-none overflow-y-auto overscroll-contain px-3 pb-3"
      >
        <For each={props.review.files}>
          {(file, index) => {
            const current = () => index() === props.review.fileIndex;
            return (
              <li>
                <button
                  type="button"
                  aria-current={current() ? "true" : undefined}
                  class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-subtle-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  classList={{
                    "bg-subtle-bg font-semibold text-accent": current(),
                  }}
                  onClick={() => {
                    selectReviewFile(index());
                    props.onClose();
                  }}
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
    </Overlay>
  );
}
