import ArrowRight from "lucide-solid/icons/arrow-right";
import GitCompareArrows from "lucide-solid/icons/git-compare-arrows";
import { For } from "solid-js";
import { Panel } from "../../ui/Panel";
import { openSnapshotFile, type ReviewSnapshot } from "./review-navigation";

export function ChangesetSummary(props: {
  snapshot: ReviewSnapshot;
  onOpen?: () => void;
}) {
  function open(filePath: string): void {
    openSnapshotFile(props.snapshot, filePath);
    props.onOpen?.();
  }

  return (
    <Panel class="changeset-card my-1 w-full max-w-[90%] self-start">
      <div class="mb-2 flex items-center gap-2 text-[0.9rem] font-semibold">
        <span class="shrink-0">
          <GitCompareArrows size={14} />
        </span>
        <span class="flex min-w-0 items-center gap-1 truncate font-mono text-[0.8rem] font-semibold">
          {props.snapshot.fromRef} <ArrowRight size={12} />{" "}
          {props.snapshot.toRef}
        </span>
        <span class="ml-auto text-xs whitespace-nowrap text-muted">
          {props.snapshot.files.length} file
          {props.snapshot.files.length !== 1 ? "s" : ""}
        </span>
      </div>
      <For each={props.snapshot.files}>
        {(file) => (
          <button
            type="button"
            class="changeset-file-row flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent py-1 pl-4 text-left font-mono text-[0.8rem] text-text hover:bg-bg"
            onClick={() => open(file.filePath)}
          >
            <span class="min-w-0 flex-1 truncate">{file.filePath}</span>
            <span class="text-xs whitespace-nowrap">
              <span class="text-ok">+{file.additions}</span>{" "}
              <span class="text-error">-{file.deletions}</span>
            </span>
          </button>
        )}
      </For>
    </Panel>
  );
}
