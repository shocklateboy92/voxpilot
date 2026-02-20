import { describe, expect, it } from "bun:test";
import { parseUnifiedDiff, buildDiffFiles } from "../src/services/diff-parser";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SIMPLE_MODIFY_DIFF = `diff --git a/src/main.ts b/src/main.ts
index 1234567..abcdefg 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,5 +1,6 @@
 import { app } from "./app";
 
-const port = 3000;
+const port = 8000;
+const host = "0.0.0.0";
 
 app.listen(port);
`;

const NEW_FILE_DIFF = `diff --git a/src/config.ts b/src/config.ts
new file mode 100644
index 0000000..abcdefg
--- /dev/null
+++ b/src/config.ts
@@ -0,0 +1,3 @@
+export const PORT = 8000;
+export const HOST = "0.0.0.0";
+export const DB_PATH = "./data.db";
`;

const DELETED_FILE_DIFF = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index abcdefg..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-hello
-world
`;

const RENAME_DIFF = `diff --git a/old-name.ts b/new-name.ts
similarity index 95%
rename from old-name.ts
rename to new-name.ts
index 1234567..abcdefg 100644
--- a/old-name.ts
+++ b/new-name.ts
@@ -1,3 +1,3 @@
-export const name = "old";
+export const name = "new";
 export const version = 1;
 export const active = true;
`;

const MULTI_FILE_DIFF = `diff --git a/a.ts b/a.ts
index 1234567..abcdefg 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3
diff --git a/b.ts b/b.ts
index 1234567..abcdefg 100644
--- a/b.ts
+++ b/b.ts
@@ -1,3 +1,2 @@
 line1
-removed
 line3
`;

const MULTI_HUNK_DIFF = `diff --git a/big.ts b/big.ts
index 1234567..abcdefg 100644
--- a/big.ts
+++ b/big.ts
@@ -1,5 +1,5 @@
 first
-old1
+new1
 middle1
 middle2
 middle3
@@ -10,5 +10,5 @@
 gap
-old2
+new2
 end1
 end2
 end3
`;

const NO_NEWLINE_DIFF = `diff --git a/no-nl.txt b/no-nl.txt
index 1234567..abcdefg 100644
--- a/no-nl.txt
+++ b/no-nl.txt
@@ -1,2 +1,2 @@
 same
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseUnifiedDiff", () => {
  describe("simple modification", () => {
    it("parses one modified file", () => {
      const result = parseUnifiedDiff(SIMPLE_MODIFY_DIFF, "art-1");
      expect(result.files).toHaveLength(1);
      expect(result.totalAdditions).toBe(2);
      expect(result.totalDeletions).toBe(1);

      const file = result.files[0];
      expect(file).toBeDefined();
      if (!file) return;
      expect(file.path).toBe("src/main.ts");
      expect(file.changeType).toBe("modified");
      expect(file.additions).toBe(2);
      expect(file.deletions).toBe(1);
      expect(file.oldPath).toBeNull();
    });

    it("parses hunk header", () => {
      const result = parseUnifiedDiff(SIMPLE_MODIFY_DIFF, "art-1");
      const file = result.files[0];
      expect(file).toBeDefined();
      if (!file) return;
      expect(file.hunks).toHaveLength(1);

      const hunk = file.hunks[0];
      expect(hunk).toBeDefined();
      if (!hunk) return;
      expect(hunk.oldStart).toBe(1);
      expect(hunk.oldLines).toBe(5);
      expect(hunk.newStart).toBe(1);
      expect(hunk.newLines).toBe(6);
    });

    it("parses diff lines with correct kinds", () => {
      const result = parseUnifiedDiff(SIMPLE_MODIFY_DIFF, "art-1");
      const file = result.files[0];
      if (!file) return;
      const hunk = file.hunks[0];
      if (!hunk) return;

      const lines = hunk.lines;
      // context, context, del, add, add, context, context
      expect(lines).toHaveLength(7);

      expect(lines[0]?.kind).toBe("context");
      expect(lines[0]?.content).toBe("import { app } from \"./app\";");
      expect(lines[0]?.oldLine).toBe(1);
      expect(lines[0]?.newLine).toBe(1);

      expect(lines[2]?.kind).toBe("del");
      expect(lines[2]?.content).toBe("const port = 3000;");
      expect(lines[2]?.oldLine).toBe(3);
      expect(lines[2]?.newLine).toBeNull();

      expect(lines[3]?.kind).toBe("add");
      expect(lines[3]?.content).toBe("const port = 8000;");
      expect(lines[3]?.oldLine).toBeNull();
      expect(lines[3]?.newLine).toBe(3);

      expect(lines[4]?.kind).toBe("add");
      expect(lines[4]?.content).toBe("const host = \"0.0.0.0\";");
      expect(lines[4]?.newLine).toBe(4);
    });
  });

  describe("new file", () => {
    it("detects added changeType", () => {
      const result = parseUnifiedDiff(NEW_FILE_DIFF, "art-2");
      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      if (!file) return;
      expect(file.changeType).toBe("added");
      expect(file.path).toBe("src/config.ts");
      expect(file.additions).toBe(3);
      expect(file.deletions).toBe(0);
    });

    it("has only add lines", () => {
      const result = parseUnifiedDiff(NEW_FILE_DIFF, "art-2");
      const file = result.files[0];
      if (!file) return;
      const hunk = file.hunks[0];
      if (!hunk) return;
      for (const line of hunk.lines) {
        expect(line.kind).toBe("add");
      }
    });
  });

  describe("deleted file", () => {
    it("detects deleted changeType", () => {
      const result = parseUnifiedDiff(DELETED_FILE_DIFF, "art-3");
      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      if (!file) return;
      expect(file.changeType).toBe("deleted");
      expect(file.path).toBe("old.txt");
      expect(file.additions).toBe(0);
      expect(file.deletions).toBe(2);
    });
  });

  describe("renamed file", () => {
    it("detects renamed changeType with oldPath", () => {
      const result = parseUnifiedDiff(RENAME_DIFF, "art-4");
      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      if (!file) return;
      expect(file.changeType).toBe("renamed");
      expect(file.path).toBe("new-name.ts");
      expect(file.oldPath).toBe("old-name.ts");
    });
  });

  describe("multi-file diff", () => {
    it("parses multiple files", () => {
      const result = parseUnifiedDiff(MULTI_FILE_DIFF, "art-5");
      expect(result.files).toHaveLength(2);
      expect(result.totalAdditions).toBe(1);
      expect(result.totalDeletions).toBe(1);

      expect(result.files[0]?.path).toBe("a.ts");
      expect(result.files[0]?.additions).toBe(1);
      expect(result.files[0]?.deletions).toBe(0);

      expect(result.files[1]?.path).toBe("b.ts");
      expect(result.files[1]?.additions).toBe(0);
      expect(result.files[1]?.deletions).toBe(1);
    });
  });

  describe("multi-hunk diff", () => {
    it("parses multiple hunks in one file", () => {
      const result = parseUnifiedDiff(MULTI_HUNK_DIFF, "art-6");
      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      if (!file) return;
      expect(file.hunks).toHaveLength(2);
      expect(file.hunks[0]?.oldStart).toBe(1);
      expect(file.hunks[1]?.oldStart).toBe(10);
    });
  });

  describe("no newline at end of file", () => {
    it("handles backslash-no-newline markers", () => {
      const result = parseUnifiedDiff(NO_NEWLINE_DIFF, "art-7");
      const file = result.files[0];
      if (!file) return;
      const hunk = file.hunks[0];
      if (!hunk) return;
      // context, del, add — the "\ No newline" lines are skipped
      expect(hunk.lines).toHaveLength(3);
      expect(hunk.lines[0]?.kind).toBe("context");
      expect(hunk.lines[1]?.kind).toBe("del");
      expect(hunk.lines[2]?.kind).toBe("add");
    });
  });

  describe("empty input", () => {
    it("returns empty result for empty string", () => {
      const result = parseUnifiedDiff("", "art-empty");
      expect(result.files).toHaveLength(0);
      expect(result.totalAdditions).toBe(0);
      expect(result.totalDeletions).toBe(0);
    });

    it("returns empty result for non-diff text", () => {
      const result = parseUnifiedDiff("some random text\nnothing here", "art-junk");
      expect(result.files).toHaveLength(0);
    });
  });

  describe("stable IDs", () => {
    it("generates consistent IDs for same input", () => {
      const r1 = parseUnifiedDiff(SIMPLE_MODIFY_DIFF, "art-100");
      const r2 = parseUnifiedDiff(SIMPLE_MODIFY_DIFF, "art-100");
      const f1 = buildDiffFiles(r1, "art-100");
      const f2 = buildDiffFiles(r2, "art-100");
      expect(f1[0]?.id).toBe(f2[0]?.id);
    });

    it("generates different IDs for different artifacts", () => {
      const r1 = parseUnifiedDiff(SIMPLE_MODIFY_DIFF, "art-a");
      const r2 = parseUnifiedDiff(SIMPLE_MODIFY_DIFF, "art-b");
      const f1 = buildDiffFiles(r1, "art-a");
      const f2 = buildDiffFiles(r2, "art-b");
      expect(f1[0]?.id).not.toBe(f2[0]?.id);
    });
  });

  describe("fullTextLine mapping", () => {
    it("sets fullTextLine for add and context lines", () => {
      const result = parseUnifiedDiff(SIMPLE_MODIFY_DIFF, "art-ft");
      const file = result.files[0];
      if (!file) return;
      const hunk = file.hunks[0];
      if (!hunk) return;

      // context lines should have fullTextLine = newLine
      const contextLine = hunk.lines[0];
      expect(contextLine?.fullTextLine).toBe(contextLine?.newLine);

      // add lines should have fullTextLine = newLine
      const addLine = hunk.lines[3];
      expect(addLine?.kind).toBe("add");
      expect(addLine?.fullTextLine).toBe(addLine?.newLine);

      // del lines should have fullTextLine = null
      const delLine = hunk.lines[2];
      expect(delLine?.kind).toBe("del");
      expect(delLine?.fullTextLine).toBeNull();
    });
  });
});

describe("buildDiffFiles", () => {
  it("builds DiffFile objects with placeholder fields", () => {
    const parsed = parseUnifiedDiff(MULTI_FILE_DIFF, "art-build");
    const files = buildDiffFiles(parsed, "art-build");
    expect(files).toHaveLength(2);

    const f = files[0];
    expect(f).toBeDefined();
    if (!f) return;
    expect(f.artifactId).toBe("art-build");
    expect(f.path).toBe("a.ts");
    expect(f.viewed).toBe(false);
    expect(f.fullTextAvailable).toBe(false);
    expect(f.fullTextContent).toBeNull();
    expect(f.hunksJson).toHaveLength(1);
  });
});
