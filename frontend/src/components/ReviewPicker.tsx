import type { ComponentProps } from "solid-js";
import { createSignal, Show } from "solid-js";
import { activeSession } from "../navigation";
import { rpc } from "../rpc";
import { ChangesetSummary } from "./ChangesetSummary";
import { Overlay } from "./Overlay";

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
    <Overlay class="session-picker" onClose={props.onClose}>
      <header class="picker-header">
        <h2>Review changes</h2>
        <button
          type="button"
          class="btn btn-ghost"
          onClick={() => props.onClose()}
        >
          Close
        </button>
      </header>
      <form class="connection-page" onSubmit={compare}>
        <label>
          Comparison
          <select value={mode()} onChange={selectMode}>
            <option value="working">Uncommitted changes</option>
            <option value="branch">Branch + working copy</option>
            <option value="committed">Committed branch changes</option>
          </select>
        </label>
        <Show when={mode() !== "working"}>
          <label>
            Base branch
            <input
              value={base()}
              required
              onInput={(e) => setBase(e.currentTarget.value)}
            />
          </label>
        </Show>
        <button type="submit" class="btn" disabled={busy()}>
          {busy() ? "Capturing…" : "Load changes"}
        </button>
        <Show when={entry()}>
          {(snapshot) => (
            <>
              <Show when={snapshot().files.length === 0}>
                <p>No changes.</p>
              </Show>
              <ChangesetSummary
                snapshot={snapshot()}
                onOpen={() => props.onClose()}
              />
            </>
          )}
        </Show>
      </form>
    </Overlay>
  );
}
