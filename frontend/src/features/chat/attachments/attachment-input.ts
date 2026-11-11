import { type Accessor, createSignal } from "solid-js";
import type { ComposerDraft } from "../create-composer-draft";

export function clipboardFiles(event: ClipboardEvent): File[] {
  return Array.from(event.clipboardData?.files ?? []);
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Only file drags are intercepted. Text/link dragging keeps native behavior. */
export function createAttachmentDrop(draft: Accessor<ComposerDraft>) {
  const [dragging, setDragging] = createSignal(false);
  let depth = 0;
  function reset() {
    depth = 0;
    setDragging(false);
  }
  return {
    dragging,
    onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    },
    onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth -= 1;
      if (depth <= 0) reset();
    },
    onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = draft().sending() ? "none" : "copy";
    },
    onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      reset();
      draft().addFiles(Array.from(event.dataTransfer?.files ?? []));
    },
    onDragEnd: reset,
  };
}
