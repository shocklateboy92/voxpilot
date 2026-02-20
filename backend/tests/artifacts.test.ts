import { describe, expect, it } from "bun:test";
import { setupTestDb } from "./helpers";
import { getDb } from "../src/db";
import {
  createArtifact,
  createArtifactFile,
  getArtifact,
  setFileViewed,
  addComment,
  deleteComment,
  updateArtifactStatus,
  getFileFullText,
  getArtifactComments,
} from "../src/services/artifacts";
import type { DiffHunk } from "../src/schemas/diff-document";

setupTestDb();

// ── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session";

function db() {
  return getDb();
}

/** Insert a prerequisite session row. */
async function seedSession(id: string = SESSION_ID) {
  const d = db();
  const { sessions } = await import("../src/schema");
  await d.insert(sessions).values({
    id,
    title: "Test Session",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

const sampleHunks: DiffHunk[] = [
  {
    id: "h-0",
    header: "@@ -1,3 +1,4 @@",
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 4,
    lines: [
      { id: "h-0-L0", kind: "context", oldLine: 1, newLine: 1, content: "a", fullTextLine: 1 },
      { id: "h-0-L1", kind: "add", oldLine: null, newLine: 2, content: "b", fullTextLine: 2 },
    ],
  },
];

async function seedArtifactAndFile(
  artifactId: string = "art-1",
  fileId: string = "f-1",
) {
  await seedSession();
  await createArtifact(db(), {
    id: artifactId,
    sessionId: SESSION_ID,
    toolName: "git_diff",
    toolCallId: "tc-1",
    commitRef: "abc123",
    title: "Test Changeset",
    totalFiles: 1,
    totalAdditions: 1,
    totalDeletions: 0,
  });
  await createArtifactFile(db(), {
    id: fileId,
    artifactId,
    path: "src/main.ts",
    changeType: "modified",
    oldPath: null,
    additions: 1,
    deletions: 0,
    html: "<div>html</div>",
    hunksJson: sampleHunks,
    fullTextAvailable: true,
    fullTextLineCount: 10,
    fullTextContent: "line1\nline2\nline3",
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("artifacts CRUD", () => {
  describe("createArtifact + getArtifact", () => {
    it("creates and retrieves an artifact", async () => {
      await seedArtifactAndFile();

      const detail = await getArtifact(db(), "art-1");
      expect(detail).not.toBeNull();
      if (!detail) return;

      expect(detail.artifact.id).toBe("art-1");
      expect(detail.artifact.sessionId).toBe(SESSION_ID);
      expect(detail.artifact.title).toBe("Test Changeset");
      expect(detail.artifact.status).toBe("pending");
      expect(detail.artifact.totalFiles).toBe(1);
      expect(detail.artifact.commitRef).toBe("abc123");
    });

    it("retrieves files with correct fields", async () => {
      await seedArtifactAndFile();

      const detail = await getArtifact(db(), "art-1");
      if (!detail) return;

      expect(detail.files).toHaveLength(1);
      const file = detail.files[0];
      expect(file).toBeDefined();
      if (!file) return;

      expect(file.id).toBe("f-1");
      expect(file.path).toBe("src/main.ts");
      expect(file.changeType).toBe("modified");
      expect(file.viewed).toBe(false);
      expect(file.html).toBe("<div>html</div>");
      expect(file.hunksJson).toHaveLength(1);
      expect(file.fullTextAvailable).toBe(true);
    });

    it("returns null for missing artifact", async () => {
      const detail = await getArtifact(db(), "nonexistent");
      expect(detail).toBeNull();
    });
  });

  describe("setFileViewed", () => {
    it("marks file as viewed", async () => {
      await seedArtifactAndFile();

      const result = await setFileViewed(db(), "f-1", true);
      expect(result).toBe(true);

      const detail = await getArtifact(db(), "art-1");
      expect(detail?.files[0]?.viewed).toBe(true);
    });

    it("marks file as unviewed", async () => {
      await seedArtifactAndFile();
      await setFileViewed(db(), "f-1", true);
      await setFileViewed(db(), "f-1", false);

      const detail = await getArtifact(db(), "art-1");
      expect(detail?.files[0]?.viewed).toBe(false);
    });

    it("returns false for missing file", async () => {
      const result = await setFileViewed(db(), "nonexistent", true);
      expect(result).toBe(false);
    });
  });

  describe("comments (add / delete / list)", () => {
    it("adds a file-level comment", async () => {
      await seedArtifactAndFile();

      const comment = await addComment(db(), "art-1", "f-1", "Looks good");
      expect(comment.id).toBeTruthy();
      expect(comment.artifactId).toBe("art-1");
      expect(comment.fileId).toBe("f-1");
      expect(comment.content).toBe("Looks good");
      expect(comment.lineId).toBeNull();
      expect(comment.lineNumber).toBeNull();
    });

    it("adds a line-level comment", async () => {
      await seedArtifactAndFile();

      const comment = await addComment(
        db(), "art-1", "f-1", "Nit: rename this",
        "h-0-L1", 2,
      );
      expect(comment.lineId).toBe("h-0-L1");
      expect(comment.lineNumber).toBe(2);
    });

    it("lists comments for an artifact", async () => {
      await seedArtifactAndFile();
      await addComment(db(), "art-1", "f-1", "Comment 1");
      await addComment(db(), "art-1", "f-1", "Comment 2");

      const comments = await getArtifactComments(db(), "art-1");
      expect(comments).toHaveLength(2);
      expect(comments[0]?.content).toBe("Comment 1");
      expect(comments[1]?.content).toBe("Comment 2");
    });

    it("returns empty array for no comments", async () => {
      await seedArtifactAndFile();
      const comments = await getArtifactComments(db(), "art-1");
      expect(comments).toHaveLength(0);
    });

    it("deletes a comment", async () => {
      await seedArtifactAndFile();
      const comment = await addComment(db(), "art-1", "f-1", "Delete me");
      const deleted = await deleteComment(db(), comment.id);
      expect(deleted).toBe(true);

      const comments = await getArtifactComments(db(), "art-1");
      expect(comments).toHaveLength(0);
    });

    it("returns false for deleting non-existent comment", async () => {
      const result = await deleteComment(db(), "nonexistent");
      expect(result).toBe(false);
    });

    it("includes comments in getArtifact detail", async () => {
      await seedArtifactAndFile();
      await addComment(db(), "art-1", "f-1", "Review note");

      const detail = await getArtifact(db(), "art-1");
      expect(detail?.comments).toHaveLength(1);
      expect(detail?.comments[0]?.content).toBe("Review note");
    });
  });

  describe("updateArtifactStatus", () => {
    it("transitions status to approved", async () => {
      await seedArtifactAndFile();

      const result = await updateArtifactStatus(db(), "art-1", "approved");
      expect(result).toBe(true);

      const detail = await getArtifact(db(), "art-1");
      expect(detail?.artifact.status).toBe("approved");
    });

    it("transitions status to changes_requested", async () => {
      await seedArtifactAndFile();

      await updateArtifactStatus(db(), "art-1", "changes_requested");
      const detail = await getArtifact(db(), "art-1");
      expect(detail?.artifact.status).toBe("changes_requested");
    });

    it("returns false for missing artifact", async () => {
      const result = await updateArtifactStatus(db(), "nonexistent", "approved");
      expect(result).toBe(false);
    });
  });

  describe("getFileFullText", () => {
    it("returns full text content when available", async () => {
      await seedArtifactAndFile();

      const result = await getFileFullText(db(), "f-1");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.content).toBe("line1\nline2\nline3");
      expect(result.lineCount).toBe(10);
    });

    it("returns null for non-existent file", async () => {
      const result = await getFileFullText(db(), "nonexistent");
      expect(result).toBeNull();
    });

    it("returns null when fullText is not available", async () => {
      await seedSession();
      await createArtifact(db(), {
        id: "art-noft",
        sessionId: SESSION_ID,
        toolName: "git_diff",
        toolCallId: "tc-2",
        commitRef: null,
        title: "No fulltext",
        totalFiles: 1,
        totalAdditions: 0,
        totalDeletions: 0,
      });
      await createArtifactFile(db(), {
        id: "f-noft",
        artifactId: "art-noft",
        path: "file.ts",
        changeType: "modified",
        oldPath: null,
        additions: 0,
        deletions: 0,
        html: "",
        hunksJson: [],
        fullTextAvailable: false,
        fullTextLineCount: null,
        fullTextContent: null,
      });

      const result = await getFileFullText(db(), "f-noft");
      expect(result).toBeNull();
    });
  });
});
