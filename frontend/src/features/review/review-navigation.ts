import type { ReviewLine } from "@plugin/rpc";
import { batch, createSignal } from "solid-js";
import { activeSessionId } from "../../app/navigation";
import type { rpc } from "../../platform/rpc";

export type ReviewSnapshot = Awaited<ReturnType<typeof rpc.compare>>;
export type ReviewFile = Pick<
  ReviewSnapshot["files"][number],
  "filePath" | "additions" | "deletions"
>;

interface ReviewPosition {
  printWidth: number;
  changeIndex: number;
  scrollTop: number;
}

interface ReviewRequest {
  cacheId: string;
  fromRef: string;
  toRef: string;
  comparison: string;
  repoRoot: string;
  filePath: string;
  files: ReviewFile[];
  fileIndex: number;
  positions: Map<string, ReviewPosition>;
  startAtEnd: boolean;
  sourceLine?: ReviewLine;
}

// The snapshot is stored by the backend. Only navigation state lives here,
// scoped to a conversation in this browser document.
const [reviews, setReviews] = createSignal(new Map<string, ReviewRequest>());
const [visibleSession, setVisibleSession] = createSignal<string>();

export function parkedReview() {
  const session = activeSessionId();
  return session ? reviews().get(session) : undefined;
}

export function reviewFile() {
  return visibleSession() === activeSessionId() ? parkedReview() : undefined;
}

function showReview(request: ReviewRequest) {
  const session = activeSessionId();
  if (!session) return;
  setReviews((previous) => new Map(previous).set(session, request));
  setVisibleSession(session);
}

export function parkReview() {
  setVisibleSession(undefined);
}

/** Forget this conversation's review position, not the backend snapshot. */
export function finishReview() {
  const session = activeSessionId();
  if (!session || !reviewFile()) return;
  batch(() => {
    parkReview();
    setReviews((previous) => {
      const next = new Map(previous);
      next.delete(session);
      return next;
    });
  });
}

export function resumeReview(): boolean {
  if (!parkedReview()) return false;
  setVisibleSession(activeSessionId());
  return true;
}

export function openSnapshotFile(
  snapshot: ReviewSnapshot,
  filePath: string,
  sourceLine?: ReviewLine,
) {
  const files = snapshot.files.map(({ filePath, additions, deletions }) => ({
    filePath,
    additions,
    deletions,
  }));
  const fileIndex = files.findIndex((file) => file.filePath === filePath);
  if (fileIndex < 0) return;
  const previous = parkedReview();
  showReview({
    cacheId: snapshot.id,
    fromRef: snapshot.resolvedFrom,
    toRef: snapshot.resolvedTo,
    comparison: `${snapshot.fromRef} → ${snapshot.toRef}`,
    repoRoot: snapshot.repoRoot,
    filePath,
    files,
    fileIndex,
    positions:
      previous?.cacheId === snapshot.id ? previous.positions : new Map(),
    startAtEnd: false,
    sourceLine,
  });
}

export function selectReviewFile(fileIndex: number, edge?: "first" | "last") {
  const request = reviewFile();
  const file = request?.files[fileIndex];
  if (!request || !file || fileIndex === request.fileIndex) return;
  if (edge) request.positions.delete(file.filePath);
  showReview({
    ...request,
    filePath: file.filePath,
    fileIndex,
    startAtEnd: edge === "last",
    sourceLine: undefined,
  });
}
