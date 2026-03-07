import { diffLines } from "diff";
import * as prettier from "prettier";
import { renderFullFileHtml } from "./diff-render";
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
  const formatter = detectFormatter(input.filePath);

  const [formattedBefore, formattedAfter] = await Promise.all([
    tryFormat(input.before, formatter, input.printWidth, input.filePath),
    tryFormat(input.after, formatter, input.printWidth, input.filePath),
  ]);

  const changes = diffLines(formattedBefore, formattedAfter);
  const hunks = buildHunks(changes);

  // Use file path as a stable file ID
  const fileId = input.filePath.replace(/[^a-zA-Z0-9._/-]/g, "_");
  const html = renderFullFileHtml(
    fileId,
    input.filePath,
    formattedAfter,
    hunks,
  );

  return { formattedBefore, formattedAfter, hunks, html };
}

// ---------------------------------------------------------------------------
// Formatter detection
// ---------------------------------------------------------------------------

type FormatterKind =
  | { type: "prettier"; parser: string }
  | { type: "ruff" }
  | { type: "passthrough" };

const prettierExtensions: Record<string, string> = {
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

const ruffExtensions = new Set(["py", "pyi"]);

function detectFormatter(filePath: string): FormatterKind {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

  const prettierParser = prettierExtensions[ext];
  if (prettierParser) {
    return { type: "prettier", parser: prettierParser };
  }

  if (ruffExtensions.has(ext)) {
    return { type: "ruff" };
  }

  return { type: "passthrough" };
}

// ---------------------------------------------------------------------------
// Format dispatch
// ---------------------------------------------------------------------------

async function tryFormat(
  content: string,
  formatter: FormatterKind,
  printWidth: number,
  filePath: string,
): Promise<string> {
  try {
    switch (formatter.type) {
      case "prettier":
        return await prettier.format(content, {
          printWidth,
          parser: formatter.parser,
        });
      case "ruff":
        return await formatWithRuff(content, printWidth, filePath);
      case "passthrough":
        return content;
    }
  } catch {
    return content;
  }
}

// ---------------------------------------------------------------------------
// Ruff formatter (Python)
// ---------------------------------------------------------------------------

async function formatWithRuff(
  content: string,
  printWidth: number,
  filePath: string,
): Promise<string> {
  const proc = Bun.spawn(
    [
      "ruff",
      "format",
      "--line-length",
      String(printWidth),
      "--stdin-filename",
      filePath,
      "-",
    ],
    {
      stdin: new Blob([content]),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [rawStdout, rawStderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`ruff format failed (exit ${exitCode}): ${rawStderr}`);
  }

  return rawStdout;
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

        // Advance past remaining context lines (not included in any hunk)
        const remaining = contextLines.length - trailingContext.length;
        oldLine += remaining;
        newLine += remaining;
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
