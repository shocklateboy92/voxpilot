import { expect, test } from "bun:test";
import type { Snapshot } from "../src/rpc";
import {
  ReviewSourceInput,
  readReviewSource,
} from "../src/services/review-source";

const snapshot = {
  id: "9bec07c6-539a-4cca-9fd8-135ae04b40bb",
  fromRef: "HEAD",
  toRef: "WORKTREE",
  resolvedFrom: "commit",
  resolvedTo: "WORKTREE",
  repoRoot: "/repo",
  createdAt: 0,
  files: [
    {
      filePath: "src/example.ts",
      additions: 1,
      deletions: 1,
      beforeContent: "first\r\nremoved\r\nlast\r\n",
      afterContent: "first\nadded\nlast\n",
    },
  ],
} satisfies ReturnType<typeof Snapshot.parse>;

test("reads original lines from the requested side of a snapshot", () => {
  const input = ReviewSourceInput.parse({
    snapshotId: snapshot.id,
    filePath: "src/example.ts",
    side: "before",
    startLine: 2,
    endLine: 2,
  });
  const before = readReviewSource(snapshot, input);
  expect(before).toContain("2: removed\n");
  expect(before).not.toContain("1: first");
  expect(readReviewSource(snapshot, { ...input, side: "after" })).toContain(
    "2: added\n",
  );
});

test("limits each response and gives the next original source line", () => {
  const [file] = snapshot.files;
  if (!file) throw new Error("Missing fixture file");
  const large = {
    ...snapshot,
    files: [{ ...file, afterContent: "source\n".repeat(205) }],
  };
  const input = ReviewSourceInput.parse({
    snapshotId: snapshot.id,
    filePath: file.filePath,
    side: "after",
  });
  const result = readReviewSource(large, input);
  expect(result).toContain(
    "200: source\n[More source available from line 201.]",
  );
  expect(readReviewSource(large, { ...input, startLine: 201 })).toContain(
    "205: source",
  );
});
