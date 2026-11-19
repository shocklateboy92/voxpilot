import { ReviewCitation } from "@plugin/rpc";
import { activeSessionId } from "../../app/navigation";
import { rpc } from "../../platform/rpc";
import { openSnapshotFile } from "./review-navigation";

const PREFIX = "voxpilot-review:";
let lastOpen = 0;

export function openReviewCitation(href: string): boolean {
  if (!href.startsWith(PREFIX)) return false;
  void open(href);
  return true;
}

async function open(href: string) {
  if (!URL.canParse(href)) throw new Error("This review link is invalid.");
  const url = new URL(href);
  const result = ReviewCitation.safeParse({
    snapshotId: url.pathname,
    filePath: url.searchParams.get("file"),
    side: url.searchParams.get("side"),
    line: Number(url.searchParams.get("line")),
  });
  if (!result.success) throw new Error("This review link is invalid.");
  const citation = result.data;
  const session = activeSessionId();
  if (!session) return;
  const request = ++lastOpen;
  const snapshot = await rpc.snapshot({ id: citation.snapshotId });
  if (session !== activeSessionId() || request !== lastOpen) return;
  if (!snapshot) throw new Error("Review snapshot not found.");
  if (!snapshot.files.some((file) => file.filePath === citation.filePath))
    throw new Error("File not found in the review snapshot.");
  openSnapshotFile(snapshot, citation.filePath, {
    side: citation.side,
    line: citation.line,
  });
}
