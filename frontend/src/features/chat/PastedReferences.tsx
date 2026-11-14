import ClipboardPaste from "lucide-solid/icons/clipboard-paste";
import X from "lucide-solid/icons/x";
import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Overlay } from "../../ui/Overlay";
import { OverlayHeader } from "../../ui/OverlayHeader";
import { Textarea } from "../../ui/Textarea";
import type { ComposerDraft, DraftReference } from "./create-composer-draft";

function referenceLabel(text: string) {
  try {
    const url = new URL(text.trim());
    if (url.protocol === "https:" || url.protocol === "http:")
      return url.hostname;
  } catch {
    // Ordinary pasted text is not necessarily a URL.
  }
  return text.trim().split("\n")[0]?.slice(0, 60) ?? "Pasted text";
}

export function PastedReferences(props: {
  draft: ComposerDraft;
  disabled: boolean;
}) {
  const [selected, setSelected] = createSignal<DraftReference>();
  return (
    <>
      <Show when={props.draft.references().length}>
        <ul
          aria-label="Pasted items"
          class="m-0 flex list-none flex-wrap gap-1.5 px-2 pt-2 pb-1"
        >
          <For each={props.draft.references()}>
            {(entry) => (
              <li class="flex min-w-0 max-w-full items-center rounded-full border border-option-border bg-option-bg">
                <button
                  type="button"
                  class="flex min-h-9 min-w-0 items-center gap-2 rounded-full px-3 text-xs text-text focus-visible:outline-2 focus-visible:outline-accent"
                  aria-label={`Preview item ${entry.number}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setSelected(entry)}
                >
                  <span class="font-mono font-semibold text-accent">
                    {entry.number}
                  </span>
                  <span class="truncate">{referenceLabel(entry.text)}</span>
                </button>
                <IconButton
                  variant="ghost"
                  aria-label={`Remove item ${entry.number}`}
                  disabled={props.disabled}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => props.draft.removeReference(entry.number)}
                >
                  <X size={14} />
                </IconButton>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={selected()}>
        {(entry) => (
          <Portal>
            <Overlay
              onClose={() => setSelected(undefined)}
              label={`Pasted item ${entry().number}`}
            >
              <OverlayHeader
                title={`Pasted item ${entry().number}`}
                onClose={() => setSelected(undefined)}
              />
              <pre class="m-0 max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-sm text-text">
                {entry().text}
              </pre>
            </Overlay>
          </Portal>
        )}
      </Show>
    </>
  );
}

export function PasteReferenceButton(props: {
  draft: ComposerDraft;
  disabled: boolean;
  compact?: boolean;
}) {
  const [manualPaste, setManualPaste] = createSignal(false);
  const [text, setText] = createSignal("");

  async function paste() {
    const current = props.draft;
    if (!navigator.clipboard?.readText) {
      setManualPaste(true);
      return;
    }
    // Permission denial uses a native-paste fallback, not an error toast.
    const value = await navigator.clipboard.readText().catch(() => undefined);
    if (current !== props.draft || props.disabled) return;
    if (value === undefined || !value.trim()) {
      setManualPaste(true);
      return;
    }
    current.addReference(value);
  }

  return (
    <>
      <Button
        variant="ghost"
        size={props.compact ? "icon" : "sm"}
        aria-label="Paste"
        title="Paste a numbered item"
        disabled={props.disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => void paste()}
      >
        <ClipboardPaste size={18} />
        <Show when={!props.compact}>Paste</Show>
      </Button>
      <Show when={manualPaste()}>
        <Portal>
          <Overlay label="Paste an item" onClose={() => setManualPaste(false)}>
            <OverlayHeader
              title="Paste an item"
              onClose={() => setManualPaste(false)}
            />
            <div class="flex flex-col gap-3 p-4">
              <p class="m-0 text-sm text-muted">
                Paste a link or text here. It will get a number you can refer to
                while speaking.
              </p>
              <Textarea
                aria-label="Pasted text"
                rows={4}
                value={text()}
                onInput={(event) => setText(event.currentTarget.value)}
              />
              <Button
                variant="primary"
                disabled={!text().trim() || props.disabled}
                onClick={() => {
                  props.draft.addReference(text());
                  setText("");
                  setManualPaste(false);
                }}
              >
                Add item
              </Button>
            </div>
          </Overlay>
        </Portal>
      </Show>
    </>
  );
}
