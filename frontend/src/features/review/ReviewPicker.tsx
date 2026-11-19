import type { ComponentProps } from "solid-js";
import { createSignal, Show } from "solid-js";
import { activeSession } from "../../app/navigation";
import { rpc } from "../../platform/rpc";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { FormField } from "../../ui/FormField";
import { Overlay } from "../../ui/Overlay";
import { OverlayHeader } from "../../ui/OverlayHeader";
import { Select } from "../../ui/Select";
import { TextInput } from "../../ui/TextInput";
import { ChangedFileList } from "./ChangedFileList";
import { openSnapshotFile } from "./review-navigation";

export function ReviewPicker(props: { onClose: () => void }) {
  const [base, setBase] = createSignal("main");
  const [mode, setMode] = createSignal<"working" | "branch" | "committed">(
    "working",
  );
  const [entry, setEntry] =
    createSignal<Awaited<ReturnType<typeof rpc.compare>>>();
  const [busy, setBusy] = createSignal(false);
  async function compare(event: SubmitEvent) {
    event.preventDefault();
    const workdir = activeSession()?.location.directory;
    if (!workdir) return;
    setBusy(true);
    try {
      setEntry(
        await rpc.compare({
          workdir,
          from: mode() === "working" ? "HEAD" : base(),
          to: "WORKTREE",
          mode:
            mode() === "working"
              ? "refs"
              : mode() === "branch"
                ? "branch"
                : "committed",
        }),
      );
    } finally {
      setBusy(false);
    }
  }
  const selectMode: ComponentProps<"select">["onChange"] = (event) => {
    const value = event.currentTarget.value;
    if (value === "working" || value === "branch" || value === "committed") {
      setMode(value);
      setEntry(undefined);
    }
  };
  return (
    <Overlay
      label="Review changes"
      class="session-picker"
      onClose={props.onClose}
    >
      <OverlayHeader title="Review changes" onClose={props.onClose} />
      <form
        class="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-6"
        onSubmit={compare}
      >
        <FormField label="Comparison">
          {(attributes) => (
            <Select {...attributes} value={mode()} onChange={selectMode}>
              <option value="working">Uncommitted changes</option>
              <option value="branch">Branch + working copy</option>
              <option value="committed">Committed branch changes</option>
            </Select>
          )}
        </FormField>
        <Show when={mode() !== "working"}>
          <FormField label="Base branch">
            {(attributes) => (
              <TextInput
                {...attributes}
                value={base()}
                required
                onInput={(e) => setBase(e.currentTarget.value)}
              />
            )}
          </FormField>
        </Show>
        <Button type="submit" disabled={busy()}>
          {busy() ? "Capturing…" : "Load changes"}
        </Button>
        <Show when={entry()}>
          {(snapshot) => (
            <Show
              when={snapshot().files.length > 0}
              fallback={<EmptyState>No changes.</EmptyState>}
            >
              <ChangedFileList
                files={snapshot().files}
                onSelect={(file) => {
                  openSnapshotFile(snapshot(), file.filePath);
                  props.onClose();
                }}
              />
            </Show>
          )}
        </Show>
      </form>
    </Overlay>
  );
}
