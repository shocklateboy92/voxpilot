/**
 * Unified diff parser.
 *
 * Parses the output of `git diff` or `git show --patch` into the
 * typed DiffDocument model. Generates stable IDs for files, hunks,
 * and lines so the frontend can anchor comments and DOM elements.
 */

import type {
  DiffLine,
  DiffHunk,
  DiffFile,
  DiffDocument,
  ChangeType,
} from "../schemas/diff-document";

// ── Stable ID generation ─────────────────────────────────────────────────────

function stableFileId(artifactId: string, path: string): string {
  // Simple deterministic hash: artifact + path
  const raw = `${artifactId}:${path}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return `f-${(hash >>> 0).toString(36)}`;
}

function stableHunkId(fileId: string, hunkIndex: number): string {
  return `${fileId}-h${hunkIndex}`;
}

function stableLineId(
  hunkId: string,
  lineIndex: number,
): string {
  return `${hunkId}-L${lineIndex}`;
}

// ── Hunk header regex ────────────────────────────────────────────────────────

const HUNK_HEADER_RE =
  /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

// ── File header detection ────────────────────────────────────────────────────

const DIFF_GIT_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const NEW_FILE_RE = /^new file mode/;
const DELETED_FILE_RE = /^deleted file mode/;

// ── Public API ───────────────────────────────────────────────────────────────

export interface ParsedDiff {
  files: ParsedFile[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface ParsedFile {
  path: string;
  oldPath: string | null;
  changeType: ChangeType;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

/**
 * Parse a unified diff string into structured data.
 *
 * @param diffText - Raw unified diff output from git.
 * @param artifactId - The artifact ID for generating stable file IDs.
 * @returns Parsed diff with files, hunks, and lines.
 */
export function parseUnifiedDiff(
  diffText: string,
  artifactId: string,
): ParsedDiff {
  const lines = diffText.split("\n");
  const files: ParsedFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      i++;
      continue;
    }

    const gitMatch = DIFF_GIT_RE.exec(line);
    if (!gitMatch) {
      i++;
      continue;
    }

    const aPath = gitMatch[1] ?? "";
    const bPath = gitMatch[2] ?? "";

    // Parse file header metadata
    i++;
    let changeType: ChangeType = "modified";
    let oldPath: string | null = null;
    let isRename = false;

    // Scan header lines until we hit a hunk or next diff or end
    while (i < lines.length) {
      const headerLine = lines[i];
      if (headerLine === undefined) {
        i++;
        continue;
      }

      if (headerLine.startsWith("@@") || headerLine.startsWith("diff --git")) {
        break;
      }

      if (NEW_FILE_RE.test(headerLine)) {
        changeType = "added";
      } else if (DELETED_FILE_RE.test(headerLine)) {
        changeType = "deleted";
      } else {
        const renameMatch = RENAME_FROM_RE.exec(headerLine);
        if (renameMatch) {
          isRename = true;
          oldPath = renameMatch[1] ?? null;
          changeType = "renamed";
        }
      }

      i++;
    }

    const filePath = bPath;
    if (isRename && !oldPath) {
      oldPath = aPath;
    }

    const fileId = stableFileId(artifactId, filePath);

    // Parse hunks for this file
    const hunks: DiffHunk[] = [];
    let fileAdditions = 0;
    let fileDeletions = 0;
    let hunkIndex = 0;

    while (i < lines.length) {
      const hunkLine = lines[i];
      if (hunkLine === undefined) {
        i++;
        continue;
      }

      if (hunkLine.startsWith("diff --git")) {
        break; // Next file
      }

      const hunkMatch = HUNK_HEADER_RE.exec(hunkLine);
      if (!hunkMatch) {
        i++;
        continue;
      }

      const oldStart = Number.parseInt(hunkMatch[1] ?? "0", 10);
      const oldLines = Number.parseInt(hunkMatch[2] ?? "1", 10);
      const newStart = Number.parseInt(hunkMatch[3] ?? "0", 10);
      const newLines = Number.parseInt(hunkMatch[4] ?? "1", 10);

      const hunkId = stableHunkId(fileId, hunkIndex);
      const diffLines: DiffLine[] = [];

      let currentOld = oldStart;
      let currentNew = newStart;
      let lineIndex = 0;

      i++; // skip hunk header

      while (i < lines.length) {
        const diffLine = lines[i];
        if (diffLine === undefined) {
          i++;
          continue;
        }

        // Stop at next hunk, next file, or end of diff content
        if (
          diffLine.startsWith("@@") ||
          diffLine.startsWith("diff --git")
        ) {
          break;
        }

        const lineId = stableLineId(hunkId, lineIndex);

        if (diffLine.startsWith("+")) {
          diffLines.push({
            id: lineId,
            kind: "add",
            oldLine: null,
            newLine: currentNew,
            content: diffLine.slice(1),
            fullTextLine: currentNew,
          });
          currentNew++;
          fileAdditions++;
        } else if (diffLine.startsWith("-")) {
          diffLines.push({
            id: lineId,
            kind: "del",
            oldLine: currentOld,
            newLine: null,
            content: diffLine.slice(1),
            fullTextLine: null,
          });
          currentOld++;
          fileDeletions++;
        } else if (diffLine.startsWith(" ")) {
          diffLines.push({
            id: lineId,
            kind: "context",
            oldLine: currentOld,
            newLine: currentNew,
            content: diffLine.slice(1),
            fullTextLine: currentNew,
          });
          currentOld++;
          currentNew++;
        } else if (diffLine.startsWith("\\")) {
          // "\ No newline at end of file" — skip
          i++;
          continue;
        } else {
          // Unknown line — could be end of diff
          break;
        }

        lineIndex++;
        i++;
      }

      hunks.push({
        id: hunkId,
        header: hunkLine,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: diffLines,
      });

      hunkIndex++;
    }

    totalAdditions += fileAdditions;
    totalDeletions += fileDeletions;

    files.push({
      path: filePath,
      oldPath,
      changeType,
      additions: fileAdditions,
      deletions: fileDeletions,
      hunks,
    });
  }

  return { files, totalAdditions, totalDeletions };
}

/**
 * Build DiffFile objects from parsed diff data.
 * HTML is generated separately; this sets html to empty string as placeholder.
 */
export function buildDiffFiles(
  parsed: ParsedDiff,
  artifactId: string,
): Omit<DiffFile, "html">[] {
  return parsed.files.map((f) => {
    const fileId = stableFileId(artifactId, f.path);
    return {
      id: fileId,
      artifactId,
      path: f.path,
      changeType: f.changeType,
      oldPath: f.oldPath,
      additions: f.additions,
      deletions: f.deletions,
      viewed: false,
      hunksJson: f.hunks,
      fullTextAvailable: false,
      fullTextLineCount: null,
      fullTextContent: null,
      fullTextHtml: null,
    };
  });
}
