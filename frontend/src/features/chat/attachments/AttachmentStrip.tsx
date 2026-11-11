import X from "lucide-solid/icons/x";
import { createSignal, For, Show } from "solid-js";
import { IconButton } from "../../../ui/IconButton";
import type { DraftAttachment } from "../create-composer-draft";
import { ImagePreview } from "./ImagePreview";

export function AttachmentStrip(props: {
  attachments: readonly DraftAttachment[];
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  const [preview, setPreview] = createSignal<DraftAttachment>();
  return (
    <>
      <ul
        aria-label="Attachments"
        class="flex max-h-40 min-w-0 flex-wrap gap-2 overflow-y-auto p-1"
      >
        <For each={props.attachments}>
          {(entry) => (
            <li class="relative w-20 shrink-0">
              <button
                type="button"
                class="block w-full overflow-hidden rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={`Preview ${entry.file.name}`}
                onClick={() => setPreview(entry)}
              >
                <img
                  src={entry.previewUrl}
                  alt=""
                  class="h-16 w-full object-cover"
                />
                <span class="block truncate px-1 text-[0.65rem] text-muted">
                  {entry.file.name}
                </span>
              </button>
              <IconButton
                aria-label={`Remove ${entry.file.name}`}
                class="absolute -top-1 -right-1"
                disabled={props.disabled}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => props.onRemove(entry.id)}
              >
                <X size={14} />
              </IconButton>
            </li>
          )}
        </For>
      </ul>
      <Show when={preview()}>
        {(entry) => (
          <ImagePreview
            src={entry().previewUrl}
            name={entry().file.name}
            onClose={() => setPreview(undefined)}
          />
        )}
      </Show>
    </>
  );
}
