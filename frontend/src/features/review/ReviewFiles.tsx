import { onMount } from "solid-js";
import { Button } from "../../ui/Button";
import { Overlay } from "../../ui/Overlay";
import { OverlayHeader } from "../../ui/OverlayHeader";
import { ChangedFileList } from "./ChangedFileList";
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
      <ChangedFileList
        files={props.review.files}
        currentPath={props.review.filePath}
        class="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3"
        listRef={(element) => {
          list = element;
        }}
        onSelect={(_, index) => {
          selectReviewFile(index);
          props.onClose();
        }}
      />
    </Overlay>
  );
}
