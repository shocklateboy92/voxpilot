import ArrowRight from "lucide-solid/icons/arrow-right";
import GitCompareArrows from "lucide-solid/icons/git-compare-arrows";
import { Panel } from "../../ui/Panel";
import { ChangedFileList } from "./ChangedFileList";
import { openSnapshotFile, type ReviewSnapshot } from "./review-navigation";

export function ChangesetSummary(props: { snapshot: ReviewSnapshot }) {
  return (
    <Panel class="changeset-card my-1 w-full self-start">
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
      <ChangedFileList
        files={props.snapshot.files}
        onSelect={(file) => openSnapshotFile(props.snapshot, file.filePath)}
      />
    </Panel>
  );
}
