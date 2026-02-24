import { diffLines } from "diff";
import * as prettier from "prettier";
import { renderDiffFileHtml } from "./diff-render";
import type { DiffHunk, DiffLine } from "./diff-types";

interface FormatDiffInput {
  before: string;
  after: string;
  filePath: string;
  printWidth: number;
}

interface FormatDiffResult {
  formattedBefore: string;
  formattedAfter: string;
  hunks: DiffHunk[];
  html: string;
}

export async function formatAndDiff(
  input: FormatDiffInput,
): Promise<FormatDiffResult> {
  const parser = detectParser(input.filePath);
  const options: prettier.Options = { printWidth: input.printWidth, parser };

  const [formattedBefore, formattedAfter] = await Promise.all([
    tryFormat(input.before, options),
    tryFormat(input.after, options),
  ]);

  const changes = diffLines(formattedBefore, formattedAfter);
  const hunks = buildHunks(changes);

  // Use file path as a stable file ID
  const fileId = input.filePath.replace(/[^a-zA-Z0-9._/-]/g, "_");
  const html = renderDiffFileHtml(fileId, input.filePath, hunks);

  return { formattedBefore, formattedAfter, hunks, html };
}

function detectParser(filePath: string): string {
  const ext = filePath.split(".").pop() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "babel",
    jsx: "babel",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    yaml: "yaml",
    yml: "yaml",
    graphql: "graphql",
  };
  return map[ext] ?? "babel";
}

async function tryFormat(
  content: string,
  options: prettier.Options,
): Promise<string> {
  try {
    return await prettier.format(content, options);
  } catch {
    return content;
  }
}

/**
 * Convert `diff` library output to our DiffHunk format.
 * Groups consecutive changes into hunks with context lines.
 */
function buildHunks(
  changes: Array<{ value: string; added?: boolean; removed?: boolean }>,
): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  let hunkLines: DiffLine[] = [];
  let hunkOldStart = 1;
  let hunkNewStart = 1;
  let lineCounter = 0;

  function flushHunk(): void {
    if (hunkLines.length === 0) return;
    hunks.push({
      id: `h-${hunks.length}`,
      header: `@@ -${hunkOldStart},${oldLine - hunkOldStart} +${hunkNewStart},${newLine - hunkNewStart} @@`,
      oldStart: hunkOldStart,
      oldLines: oldLine - hunkOldStart,
      newStart: hunkNewStart,
      newLines: newLine - hunkNewStart,
      lines: hunkLines,
    });
    hunkLines = [];
  }

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, "").split("\n");

    if (change.added) {
      if (hunkLines.length === 0) {
        hunkOldStart = oldLine;
        hunkNewStart = newLine;
      }
      for (const line of lines) {
        hunkLines.push({
          id: `L${lineCounter++}`,
          kind: "add",
          oldLine: null,
          newLine: newLine,
          content: line,
          fullTextLine: newLine,
        });
        newLine++;
      }
    } else if (change.removed) {
      if (hunkLines.length === 0) {
        hunkOldStart = oldLine;
        hunkNewStart = newLine;
      }
      for (const line of lines) {
        hunkLines.push({
          id: `L${lineCounter++}`,
          kind: "del",
          oldLine: oldLine,
          newLine: null,
          content: line,
          fullTextLine: null,
        });
        oldLine++;
      }
    } else {
      // Context lines. If we have accumulated changes, add some context and flush.
      const contextLines = lines;

      if (hunkLines.length > 0) {
        // Add trailing context (up to 3 lines)
        const trailingContext = contextLines.slice(0, 3);
        for (const line of trailingContext) {
          hunkLines.push({
            id: `L${lineCounter++}`,
            kind: "context",
            oldLine: oldLine,
            newLine: newLine,
            content: line,
            fullTextLine: newLine,
          });
          oldLine++;
          newLine++;
        }
        flushHunk();

        // Skip middle context lines
        const remaining = contextLines.length - trailingContext.length;
        if (remaining > 3) {
          oldLine += remaining - 3;
          newLine += remaining - 3;
        }

        // Leading context for next hunk (up to 3 lines from end)
        if (remaining > 0) {
          const leadingStart = Math.max(0, remaining - 3);
          const leading = contextLines.slice(
            trailingContext.length + leadingStart,
          );
          // Don't add leading context yet - it will be added when the next change starts
          // But track the line numbers
          oldLine += leading.length - (remaining > 3 ? 0 : remaining);
          newLine += leading.length - (remaining > 3 ? 0 : remaining);
        }
      } else {
        // No accumulated changes, just advance line counters
        oldLine += contextLines.length;
        newLine += contextLines.length;
      }
    }
  }

  flushHunk();
  return hunks;
}
