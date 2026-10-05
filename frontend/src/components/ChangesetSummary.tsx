import ArrowRight from "lucide-solid/icons/arrow-right";
import GitCompareArrows from "lucide-solid/icons/git-compare-arrows";
import { For } from "solid-js";
import type { rpc } from "../rpc";
import { setReviewFile } from "./ReviewOverlay";

export type ReviewSnapshot = Awaited<ReturnType<typeof rpc.compare>>;

export function openSnapshotFile(
  snapshot: ReviewSnapshot,
  filePath: string,
): void {
  const files = snapshot.files.map((file) => file.filePath);
  const fileIndex = files.indexOf(filePath);
  setReviewFile({
    cacheId: snapshot.id,
    fromRef: snapshot.resolvedFrom,
    toRef: snapshot.resolvedTo,
    repoRoot: snapshot.repoRoot,
    filePath,
    files,
    fileIndex: fileIndex >= 0 ? fileIndex : 0,
  });
}

export function ChangesetSummary(props: {
  snapshot: ReviewSnapshot;
  onOpen?: () => void;
}) {
  function open(filePath: string): void {
    openSnapshotFile(props.snapshot, filePath);
    props.onOpen?.();
  }

  return (
    <div class="changeset-card">
      <div class="changeset-header">
        <span class="changeset-icon">
          <GitCompareArrows size={14} />
        </span>
        <span class="changeset-label">
          {props.snapshot.fromRef} <ArrowRight size={12} />{" "}
          {props.snapshot.toRef}
        </span>
        <span class="changeset-stats">
          {props.snapshot.files.length} file
          {props.snapshot.files.length !== 1 ? "s" : ""}
        </span>
      </div>
      <For each={props.snapshot.files}>
        {(file) => (
          <button
            type="button"
            class="changeset-file-row"
            onClick={() => open(file.filePath)}
          >
            <span class="changeset-file-path">{file.filePath}</span>
            <span class="changeset-file-stats">
              <span class="changeset-adds">+{file.additions}</span>{" "}
              <span class="changeset-dels">-{file.deletions}</span>
            </span>
          </button>
        )}
      </For>
    </div>
  );
}
