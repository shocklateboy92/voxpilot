import { diffLines } from "diff";
import * as prettier from "prettier";
import type { ReviewLine } from "../rpc";
import { highlightDiff } from "./diff-highlight";
import { renderFullFileHtml } from "./diff-render";
import type { DiffHunk, DiffLine } from "./diff-types";
import { languageForFile, reflowComments } from "./reflow-comments";
import { mapSourceLine } from "./source-line-map";

interface FormatDiffInput {
  before: string;
  after: string;
  filePath: string;
  printWidth: number;
  signal?: AbortSignal;
  sourceLine?: ReviewLine;
}

interface FormatDiffResult {
  formattedBefore: string;
  formattedAfter: string;
  hunks: DiffHunk[];
  html: string;
  targetRow?: ReviewLine;
}

export async function formatAndDiff(
  input: FormatDiffInput,
): Promise<FormatDiffResult> {
  input.signal?.throwIfAborted();
  const [reflowedBefore, reflowedAfter] = await Promise.all([
    formatCode(input.before, input.filePath, input.printWidth, input.signal),
    formatCode(input.after, input.filePath, input.printWidth, input.signal),
  ]);

  const changes = diffLines(reflowedBefore, reflowedAfter);
  const targetRow = locateRow(input, reflowedBefore, reflowedAfter, changes);
  const hunks = buildHunks(changes);
  const highlight = await highlightDiff(
    input.filePath,
    reflowedBefore,
    reflowedAfter,
  );
  input.signal?.throwIfAborted();

  // Use file path as a stable file ID
  const fileId = input.filePath.replace(/[^a-zA-Z0-9._/-]/g, "_");
  const html = renderFullFileHtml(
    fileId,
    input.filePath,
    reflowedAfter,
    hunks,
    highlight,
  );

  return {
    formattedBefore: reflowedBefore,
    formattedAfter: reflowedAfter,
    hunks,
    html,
    ...(targetRow ? { targetRow } : {}),
  };
}

/** Display-only formatting shared by single-file previews and reviews. */
export async function formatCode(
  text: string,
  filePath: string,
  printWidth: number,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const formatted = await tryFormat(
    text,
    detectFormatter(filePath),
    printWidth,
    filePath,
    signal,
  );
  signal?.throwIfAborted();
  const commentLang = languageForFile(filePath);
  return commentLang
    ? reflowComments(formatted, commentLang, printWidth)
    : formatted;
}

/** Context lines on the before side are rendered as ordinary after rows. */
function locateRow(
  input: FormatDiffInput,
  before: string,
  after: string,
  changes: ReturnType<typeof diffLines>,
): ReviewLine | undefined {
  const target = input.sourceLine;
  if (!target) return;
  if (target.side === "after") {
    const line = mapSourceLine(input.after, after, target.line);
    return line === undefined ? undefined : { side: "after", line };
  }
  const line = mapSourceLine(input.before, before, target.line);
  if (line === undefined) return;
  let oldLine = 1;
  let newLine = 1;
  for (const change of changes) {
    const count = change.count;
    if (!change.added) {
      if (line < oldLine + count)
        return change.removed
          ? { side: "before", line }
          : { side: "after", line: newLine + line - oldLine };
      oldLine += count;
    }
    if (!change.removed) newLine += count;
  }
}

// ---------------------------------------------------------------------------
// Formatter detection
// ---------------------------------------------------------------------------

type FormatterKind =
  | { type: "prettier"; parser: string }
  | { type: "ruff" }
  | { type: "rustfmt" }
  | { type: "clang-format" }
  | { type: "passthrough" };

const prettierExtensions: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "babel",
  jsx: "babel",
  mjs: "babel",
  cjs: "babel",
  json: "json",
  css: "css",
  html: "html",
  htm: "html",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  graphql: "graphql",
};

const ruffExtensions = new Set(["py", "pyi"]);

const clangFormatExtensions = new Set([
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hh",
  "hpp",
  "hxx",
]);

function detectFormatter(filePath: string): FormatterKind {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

  const prettierParser = prettierExtensions[ext];
  if (prettierParser) {
    return { type: "prettier", parser: prettierParser };
  }

  if (ruffExtensions.has(ext)) {
    return { type: "ruff" };
  }

  if (ext === "rs") {
    return { type: "rustfmt" };
  }

  if (clangFormatExtensions.has(ext)) {
    return { type: "clang-format" };
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
  signal?: AbortSignal,
): Promise<string> {
  try {
    switch (formatter.type) {
      case "prettier":
        return await prettier.format(content, {
          printWidth,
          parser: formatter.parser,
        });
      case "ruff":
        return await formatWithRuff(content, printWidth, filePath, signal);
      case "rustfmt":
        return await formatWithRustfmt(content, printWidth, signal);
      case "clang-format":
        return await formatWithClangFormat(
          content,
          printWidth,
          filePath,
          signal,
        );
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
  signal?: AbortSignal,
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
      signal,
      timeout: 30_000,
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

// ---------------------------------------------------------------------------
// rustfmt formatter (Rust)
// ---------------------------------------------------------------------------

async function formatWithRustfmt(
  content: string,
  printWidth: number,
  signal?: AbortSignal,
): Promise<string> {
  if (content === "") return content;

  const proc = Bun.spawn(
    [
      "rustfmt",
      "--emit",
      "stdout",
      "--color",
      "never",
      "--edition",
      "2024",
      // Review snapshots are standalone files, not a Cargo workspace. Ignore
      // ambient config and never pass a filename (which could follow modules).
      "--config-path",
      "/dev/null",
      "--config",
      `max_width=${printWidth},tab_spaces=2,hard_tabs=false,reorder_imports=false,reorder_modules=false`,
    ],
    {
      stdin: new Blob([content]),
      signal,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [rawStdout, rawStderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (!canUseRustfmtOutput(proc, rawStdout)) {
    throw new Error(`rustfmt failed (exit ${exitCode}): ${rawStderr}`);
  }

  return rawStdout;
}

export function canUseRustfmtOutput(
  result: Pick<Bun.Subprocess, "exitCode" | "signalCode">,
  stdout: string,
): boolean {
  // Display-only, best-effort policy: exit 1 can accompany usable output, e.g.
  // when opaque macros retain whitespace. This is not error classification.
  // Inspect trimmed text only for emptiness; never trim actual string contents.
  return (
    result.signalCode === null &&
    (result.exitCode === 0 || result.exitCode === 1) &&
    stdout.trim() !== ""
  );
}

// ---------------------------------------------------------------------------
// clang-format formatter (C/C++)
// ---------------------------------------------------------------------------

async function formatWithClangFormat(
  content: string,
  printWidth: number,
  filePath: string,
  signal?: AbortSignal,
): Promise<string> {
  // A display profile, not the repository's source style: spend narrow screens
  // on code rather than alignment, and keep wrapped lists easy to scan.
  const style = JSON.stringify({
    BasedOnStyle: "LLVM",
    ColumnLimit: printWidth,
    IndentWidth: 2,
    ContinuationIndentWidth: 2,
    UseTab: "Never",
    AlignAfterOpenBracket: "BlockIndent",
    BinPackArguments: false,
    BinPackParameters: false,
    AlignOperands: "DontAlign",
    AlignEscapedNewlines: "DontAlign",
    BreakStringLiterals: false,
    ReflowComments: false,
    SortIncludes: false,
  });
  const proc = Bun.spawn(
    ["clang-format", `--style=${style}`, `--assume-filename=${filePath}`],
    {
      stdin: new Blob([content]),
      signal,
      timeout: 30_000,
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
    throw new Error(`clang-format failed (exit ${exitCode}): ${rawStderr}`);
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
