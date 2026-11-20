import X from "lucide-solid/icons/x";
import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { ViewerSelection } from "../../platform/prompt-files";
import { IconButton } from "../../ui/IconButton";
import { Overlay } from "../../ui/Overlay";
import { OverlayHeader } from "../../ui/OverlayHeader";
import type { ComposerDraft } from "./create-composer-draft";
import { MAX_EXCERPT } from "./viewer-selection";

export function SelectionReference(props: {
  draft: ComposerDraft;
  disabled: boolean;
}) {
  const [preview, setPreview] = createSignal<ViewerSelection>();
  return (
    <Show when={props.draft.selection()}>
      {(excerpt) => (
        <>
          <div class="m-1 flex min-w-0 max-w-full items-center self-start rounded-full border border-option-border bg-option-bg">
            <button
              type="button"
              class="min-h-9 min-w-0 cursor-pointer rounded-full px-3 text-xs text-text focus-visible:outline-2 focus-visible:outline-accent"
              aria-label="Preview selection"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setPreview(excerpt())}
            >
              Selection
            </button>
            <IconButton
              variant="ghost"
              aria-label="Remove selection"
              disabled={props.disabled}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => props.draft.setSelection(undefined)}
            >
              <X size={14} />
            </IconButton>
          </div>
          <Show when={preview() === excerpt()}>
            <Portal>
              <Overlay
                label="Selected passage"
                onClose={() => setPreview(undefined)}
              >
                <OverlayHeader
                  title="Selected passage"
                  onClose={() => setPreview(undefined)}
                />
                <div class="overflow-auto p-4">
                  <p class="mb-2 wrap-anywhere text-xs text-muted">
                    {excerpt().viewer.filePath}
                    {excerpt().side ? ` · ${excerpt().side}` : ""}
                  </p>
                  <pre class="m-0 font-mono text-sm wrap-break-word whitespace-pre-wrap">
                    {excerpt().text}
                  </pre>
                  <Show when={excerpt().truncated}>
                    <p class="mt-2 text-xs text-muted">
                      Selection shortened to {MAX_EXCERPT.toLocaleString()}{" "}
                      characters.
                    </p>
                  </Show>
                </div>
              </Overlay>
            </Portal>
          </Show>
        </>
      )}
    </Show>
  );
}
