/**
 * Comment reflow — word-wraps comment text to fit a target printWidth.
 *
 * Runs as a post-processing pass after code formatting (prettier / ruff /
 * clang-format), because those formatters do not reflow comment prose.
 *
 * Supports:
 *  - JS/TS: `// …`, `/* … *​/`, `/** … *​/` (JSDoc)
 *  - Python: `# …`, `"""…"""` / `'''…'''` docstrings
 *  - C/C++: `// …`, `/* … *​/`
 *
 * Skips reflow for:
 *  - Directive / pragma comments (eslint, ts-ignore, noqa, fmt, type:, …)
 *  - Fenced code blocks (``` …)
 *  - Lines that look like tables or intentional alignment
 *  - Lines containing long URLs that would break if wrapped
 *  - Markdown list items / headings inside comments
 *  - JSDoc / Doxygen tags (@param, @returns, etc.)
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reflow comments in `content` to fit within `printWidth`.
 *
 * The `language` parameter determines which comment syntaxes to look for.
 * Returns the content with overlong comment lines word-wrapped.
 */
export function reflowComments(
  content: string,
  language: CommentLanguage,
  printWidth: number,
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const currentLine = lines[i];
    if (currentLine === undefined) {
      i++;
      continue;
    }

    // --- Try block comments first (/* ... */ and docstrings) ---
    if (language.block) {
      const blockResult = tryReflowBlockComment(
        lines,
        i,
        language.block,
        printWidth,
      );
      if (blockResult) {
        result.push(...blockResult.lines);
        i = blockResult.nextIndex;
        continue;
      }
    }

    // --- Try Python docstrings ---
    if (language.docstring) {
      const docResult = tryReflowDocstring(
        lines,
        i,
        language.docstring,
        printWidth,
      );
      if (docResult) {
        result.push(...docResult.lines);
        i = docResult.nextIndex;
        continue;
      }
    }

    // --- Try line comments (// or #) ---
    if (language.line) {
      const lineResult = tryReflowLineCommentBlock(
        lines,
        i,
        language.line,
        printWidth,
      );
      if (lineResult) {
        result.push(...lineResult.lines);
        i = lineResult.nextIndex;
        continue;
      }
    }

    // Not a comment — pass through
    result.push(currentLine);
    i++;
  }

  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Language definitions
// ---------------------------------------------------------------------------

export type CommentLanguage = {
  line?: LineCommentSyntax;
  block?: BlockCommentSyntax;
  docstring?: DocstringSyntax;
};

interface LineCommentSyntax {
  /** The line comment prefix, e.g. "//" or "#" */
  prefix: string;
}

interface BlockCommentSyntax {
  /** Opening delimiter, e.g. "/*" */
  open: string;
  /** Closing delimiter, e.g. "*​/" */
  close: string;
  /**
   * Continuation prefix inside the block (after the opening line).
   * e.g. " * " for JSDoc / C-style block comments.
   * If not set, lines inside the block have no expected prefix.
   */
  continuation?: string;
}

interface DocstringSyntax {
  /** The triple-quote delimiter, e.g. '"""' or "'''" */
  delimiter: string;
}

export const LANGUAGES = {
  js: {
    line: { prefix: "//" },
    block: { open: "/*", close: "*/", continuation: " * " },
  },
  ts: {
    line: { prefix: "//" },
    block: { open: "/*", close: "*/", continuation: " * " },
  },
  python: {
    line: { prefix: "#" },
    docstring: { delimiter: '"""' },
  },
  cpp: {
    line: { prefix: "//" },
    block: { open: "/*", close: "*/", continuation: " * " },
  },
} as const satisfies Record<string, CommentLanguage>;

type LanguageKey = keyof typeof LANGUAGES;

/**
 * Map file extensions to comment language keys.
 */
const EXT_TO_LANGUAGE: Record<string, LanguageKey> = {
  ts: "ts",
  tsx: "ts",
  js: "js",
  jsx: "js",
  py: "python",
  pyi: "python",
  c: "cpp",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  h: "cpp",
  hh: "cpp",
  hpp: "cpp",
  hxx: "cpp",
};

/**
 * Look up the comment language for a file path based on its extension.
 * Returns `undefined` if no comment reflow is supported for this file type.
 */
export function languageForFile(filePath: string): CommentLanguage | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const langKey = EXT_TO_LANGUAGE[ext];
  if (!langKey) return undefined;
  return LANGUAGES[langKey];
}

// ---------------------------------------------------------------------------
// Skip heuristics
// ---------------------------------------------------------------------------

/** Directives / pragmas that should never be reflowed. */
const DIRECTIVE_PATTERNS = [
  // JS/TS
  /^\s*\/\/\s*@ts-/,
  /^\s*\/\/\s*eslint-/,
  /^\s*\/\/\s*prettier-/,
  /^\s*\/\/\s*biome-/,
  /^\s*\/\/\s*istanbul /,
  /^\s*\/\/\s*c8 /,
  /^\s*\/\/\s*@jsx/,
  /^\s*\/\/\s*@ts-expect-error/,
  /^\s*\/\/\s*@ts-nocheck/,
  /^\s*\/\/\s*TODO[:(]/i,
  /^\s*\/\/\s*FIXME[:(]/i,
  /^\s*\/\/\s*HACK[:(]/i,
  /^\s*\/\/\s*NOTE[:(]/i,
  // Python
  /^\s*#\s*type:\s*/,
  /^\s*#\s*noqa/,
  /^\s*#\s*pragma/,
  /^\s*#\s*fmt:\s*(on|off)/,
  /^\s*#\s*pylint:/,
  /^\s*#\s*mypy:/,
  /^\s*#\s*pyright:/,
  /^\s*#\s*ruff:/,
  /^\s*#\s*isort:/,
  /^\s*#!\//,
  // C/C++
  /^\s*\/\/\s*NOLINT/,
  /^\s*\/\/\s*IWYU/,
  /^\s*#\s*pragma/,
];

function isDirective(line: string): boolean {
  return DIRECTIVE_PATTERNS.some((pat) => pat.test(line));
}

/** Lines that look like markdown structure and shouldn't be merged. */
function isStructuredLine(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    // Markdown list items
    /^[-*+]\s/.test(trimmed) ||
    // Numbered lists
    /^\d+[.)]\s/.test(trimmed) ||
    // Headings
    /^#{1,6}\s/.test(trimmed) ||
    // Blockquotes
    trimmed.startsWith("> ") ||
    // Fenced code block delimiters
    trimmed.startsWith("```") ||
    // JSDoc / Doxygen tags
    /^@\w+/.test(trimmed) ||
    // reStructuredText directives
    /^:\w+:/.test(trimmed) ||
    // Table-like lines (multiple pipes or aligned dashes)
    (trimmed.includes("|") && (trimmed.match(/\|/g)?.length ?? 0) >= 2) ||
    /^[-=]{3,}$/.test(trimmed)
  );
}

/** Check if a line contains a URL that spans most of the line. */
function hasLongUrl(text: string): boolean {
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (!urlMatch) return false;
  // If the URL is more than 60% of the text content, don't reflow
  return urlMatch[0].length > text.trim().length * 0.6;
}

/** Whether a content line should be skipped from reflow. */
function shouldSkipLine(text: string): boolean {
  return isStructuredLine(text) || hasLongUrl(text);
}

// ---------------------------------------------------------------------------
// Word-wrap engine
// ---------------------------------------------------------------------------

/**
 * Word-wrap `text` to fit within `width` characters.
 * Returns an array of wrapped lines (without trailing newlines).
 * If text is already within width, returns it as-is in a single-element array.
 */
function wordWrap(text: string, width: number): string[] {
  if (width < 10) return [text];
  if (text.length <= width) return [text];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  return lines.length > 0 ? lines : [text];
}

// ---------------------------------------------------------------------------
// Line comment reflow (// … or # …)
// ---------------------------------------------------------------------------

interface ReflowResult {
  lines: string[];
  nextIndex: number;
}

/**
 * Detect a consecutive block of line comments starting at `startIdx`
 * and reflow the prose within them.
 */
function tryReflowLineCommentBlock(
  lines: string[],
  startIdx: number,
  syntax: LineCommentSyntax,
  printWidth: number,
): ReflowResult | undefined {
  const prefix = syntax.prefix;
  const line = lines[startIdx];
  if (line === undefined) return undefined;

  // Match: <indent><prefix><space><text>
  const pat = new RegExp(`^(\\s*${escapeRegExp(prefix)})(\\s)(.*)$`);
  const match = line.match(pat);
  if (!match) return undefined;

  const indent = match[1] ?? "";
  const sep = match[2] ?? " ";
  const fullPrefix = indent + sep;
  const prefixWidth = fullPrefix.length;

  // Check for directive
  if (isDirective(line)) {
    return { lines: [line], nextIndex: startIdx + 1 };
  }

  // Truncate decorative separator lines (e.g. "// ----------") to fit printWidth
  const separatorTruncated = truncateSeparator(line, fullPrefix, printWidth);
  if (separatorTruncated !== undefined) {
    return { lines: [separatorTruncated], nextIndex: startIdx + 1 };
  }

  // Collect consecutive lines with the same indent + prefix
  const blockLines: string[] = [];
  let end = startIdx;

  while (end < lines.length) {
    const cur = lines[end];
    if (cur === undefined) break;

    // Must start with the same indent+prefix
    if (!cur.startsWith(indent)) break;

    const rest = cur.slice(indent.length);

    // Allow empty comment lines (just "//") as paragraph separators
    if (rest.trim() === "") {
      blockLines.push("");
      end++;
      continue;
    }

    // Must have at least one space after the prefix
    if (!/^\s/.test(rest)) break;

    // Skip directives — stop collecting
    if (isDirective(cur)) break;

    const text = rest.replace(/^\s/, "");
    blockLines.push(text);
    end++;
  }

  if (blockLines.length <= 1) {
    // Single line — check if it needs wrapping
    if (line.length <= printWidth) {
      return { lines: [line], nextIndex: startIdx + 1 };
    }
    const text = blockLines[0] ?? "";
    if (shouldSkipLine(text)) {
      return { lines: [line], nextIndex: startIdx + 1 };
    }
    const wrapped = wordWrap(text, printWidth - prefixWidth);
    return {
      lines: wrapped.map((w) => fullPrefix + w),
      nextIndex: startIdx + 1,
    };
  }

  // Multi-line block: group into paragraphs, reflow each
  const available = printWidth - prefixWidth;
  const reflowed = reflowParagraphs(blockLines, available);
  return {
    lines: reflowed.map((l) => {
      if (l === "") return indent;
      const full = fullPrefix + l;
      return truncateSeparator(full, fullPrefix, printWidth) ?? full;
    }),
    nextIndex: end,
  };
}

// ---------------------------------------------------------------------------
// Block comment reflow (/* … */ and /** … */)
// ---------------------------------------------------------------------------

/**
 * Detect a block comment starting at `startIdx` and reflow the prose within.
 */
function tryReflowBlockComment(
  lines: string[],
  startIdx: number,
  syntax: BlockCommentSyntax,
  printWidth: number,
): ReflowResult | undefined {
  const line = lines[startIdx];
  if (line === undefined) return undefined;

  const trimmed = line.trimStart();

  // Must start with the open delimiter
  if (!trimmed.startsWith(syntax.open)) return undefined;

  const indent = line.slice(0, line.length - trimmed.length);

  // --- Single-line block comment: /* ... */ on one line ---
  if (
    trimmed.includes(syntax.close) &&
    trimmed.indexOf(syntax.close) > syntax.open.length
  ) {
    const closeIdx = trimmed.indexOf(syntax.close);
    const inner = trimmed.slice(syntax.open.length, closeIdx).trim();

    // Measure full prefix: indent + "/* "
    const fullPrefix = `${indent + syntax.open} `;
    const fullSuffix = ` ${syntax.close}`;
    const available = printWidth - fullPrefix.length - fullSuffix.length;

    if (line.length <= printWidth || shouldSkipLine(inner) || available < 10) {
      return { lines: [line], nextIndex: startIdx + 1 };
    }

    const wrapped = wordWrap(inner, available);
    if (wrapped.length === 1) {
      return { lines: [line], nextIndex: startIdx + 1 };
    }

    // Convert to multi-line block comment
    const resultLines: string[] = [indent + syntax.open];
    const contPrefix = indent + (syntax.continuation ?? " ");
    for (const w of wrapped) {
      resultLines.push(contPrefix + w);
    }
    resultLines.push(`${indent} ${syntax.close}`);
    return { lines: resultLines, nextIndex: startIdx + 1 };
  }

  // --- Multi-line block comment ---
  // Find the closing delimiter
  let end = startIdx;
  while (end < lines.length) {
    const endLine = lines[end];
    if (
      end > startIdx &&
      endLine !== undefined &&
      endLine.includes(syntax.close)
    ) {
      end++;
      break;
    }
    end++;
    if (end >= lines.length) break;
  }

  // If we didn't find the close, bail out
  const lastLine = lines[end - 1];
  if (lastLine === undefined || !lastLine.includes(syntax.close)) {
    return undefined;
  }

  // Extract the inner lines (between open and close)
  const commentLines = lines.slice(startIdx, end);

  // Determine the continuation prefix
  const contStr = syntax.continuation ?? " ";
  const contPrefix = indent + contStr;
  const contPrefixWidth = contPrefix.length;

  // Extract text from each inner line
  const innerTexts: string[] = [];

  for (let ci = 0; ci < commentLines.length; ci++) {
    const cl = commentLines[ci];
    if (cl === undefined) continue;

    if (ci === 0) {
      // Opening line: extract text after "/*" or "/**"
      const afterOpen = cl.slice(cl.indexOf(syntax.open) + syntax.open.length);
      const text = afterOpen.trim();
      if (text && text !== syntax.close.trim()) {
        innerTexts.push(text);
      }
      continue;
    }

    if (ci === commentLines.length - 1) {
      // Closing line: extract text before "*/"
      const beforeClose = cl.slice(0, cl.indexOf(syntax.close));
      const text = beforeClose.replace(/^\s*\*?\s?/, "").trim();
      if (text) {
        innerTexts.push(text);
      }
      continue;
    }

    // Middle line: strip continuation prefix
    let text: string = cl;
    // Try stripping the exact continuation prefix
    if (text.trimStart().startsWith("*")) {
      text = text.replace(/^\s*\*\s?/, "");
    } else {
      text = text.replace(new RegExp(`^\\s{0,${indent.length + 2}}`), "");
    }

    innerTexts.push(text);
  }

  // Check if entire block already fits
  const allFit = commentLines.every((cl) => cl.length <= printWidth);
  if (allFit && innerTexts.every((t) => !shouldSkipLine(t))) {
    // Already fits — but still check if it needs reflow due to prose paragraphs
    // Only reflow if we have multi-word text that could benefit
    const hasLongProse = innerTexts.some(
      (t) =>
        t.split(/\s+/).length > 3 && t.length > printWidth - contPrefixWidth,
    );
    if (!hasLongProse) {
      return { lines: commentLines, nextIndex: end };
    }
  }

  // Reflow the inner text
  const available = printWidth - contPrefixWidth;
  if (available < 10) {
    return { lines: commentLines, nextIndex: end };
  }

  const reflowed = reflowParagraphs(innerTexts, available);

  // Rebuild the block comment
  const resultLines: string[] = [indent + syntax.open];
  for (const rl of reflowed) {
    if (rl === "") {
      resultLines.push(`${indent} *`);
    } else {
      resultLines.push(contPrefix + rl);
    }
  }
  resultLines.push(`${indent} ${syntax.close}`);

  return { lines: resultLines, nextIndex: end };
}

// ---------------------------------------------------------------------------
// Python docstring reflow ("""…""" and '''…''')
// ---------------------------------------------------------------------------

function tryReflowDocstring(
  lines: string[],
  startIdx: number,
  syntax: DocstringSyntax,
  printWidth: number,
): ReflowResult | undefined {
  const line = lines[startIdx];
  if (line === undefined) return undefined;

  const trimmed = line.trimStart();
  const delim = syntax.delimiter;

  if (!trimmed.startsWith(delim)) return undefined;

  const indent = line.slice(0, line.length - trimmed.length);

  // --- Single-line docstring: """...""" on one line ---
  const afterOpen = trimmed.slice(delim.length);
  const closeIdx = afterOpen.indexOf(delim);
  if (closeIdx >= 0 && afterOpen.slice(closeIdx + delim.length).trim() === "") {
    const inner = afterOpen.slice(0, closeIdx).trim();
    const fullPrefix = indent + delim;
    const available = printWidth - fullPrefix.length - delim.length;

    if (line.length <= printWidth || shouldSkipLine(inner) || available < 10) {
      return { lines: [line], nextIndex: startIdx + 1 };
    }

    // Reflow and convert to multi-line docstring
    const wrapped = wordWrap(inner, available);
    if (wrapped.length === 1) {
      return { lines: [line], nextIndex: startIdx + 1 };
    }

    const contIndent = `${indent}    `;
    const bodyAvailable = printWidth - contIndent.length;
    const rewrapped = wordWrap(inner, bodyAvailable);

    const resultLines: string[] = [indent + delim];
    for (const w of rewrapped) {
      resultLines.push(contIndent + w);
    }
    resultLines.push(indent + delim);
    return { lines: resultLines, nextIndex: startIdx + 1 };
  }

  // --- Multi-line docstring ---
  let end = startIdx + 1;
  while (end < lines.length) {
    const endLine = lines[end];
    if (endLine?.includes(delim)) {
      end++;
      break;
    }
    end++;
    if (end >= lines.length) break;
  }

  // Verify we found the closing delimiter
  const lastLine = lines[end - 1];
  if (
    lastLine === undefined ||
    !lastLine.includes(delim) ||
    end - 1 === startIdx
  ) {
    return undefined;
  }

  const commentLines = lines.slice(startIdx, end);

  // Determine continuation indent (typically 4 spaces beyond the def indent)
  // Look at the second line (first body line) to detect actual indent
  let contIndent = `${indent}    `;
  if (commentLines.length > 1) {
    const secondLine = commentLines[1];
    if (secondLine !== undefined) {
      const secondIndentMatch = secondLine.match(/^(\s+)/);
      if (
        secondIndentMatch !== null &&
        secondIndentMatch[1] !== undefined &&
        secondIndentMatch[1].length > indent.length
      ) {
        contIndent = secondIndentMatch[1];
      }
    }
  }
  const contIndentWidth = contIndent.length;

  // Extract inner texts
  const innerTexts: string[] = [];
  for (let ci = 0; ci < commentLines.length; ci++) {
    const cl = commentLines[ci];
    if (cl === undefined) continue;

    if (ci === 0) {
      // Opening line — text after """
      const after = cl.slice(cl.indexOf(delim) + delim.length).trim();
      if (after) innerTexts.push(after);
      continue;
    }

    if (ci === commentLines.length - 1) {
      // Closing line — text before """
      const before = cl.slice(0, cl.indexOf(delim)).trim();
      if (before) innerTexts.push(before);
      continue;
    }

    // Middle line — strip common indent
    const stripped = cl.startsWith(contIndent)
      ? cl.slice(contIndent.length)
      : cl.trimStart();
    innerTexts.push(stripped);
  }

  // Check if reflow is needed
  const allFit = commentLines.every((cl) => cl.length <= printWidth);
  const hasLongProse = innerTexts.some(
    (t) => t.split(/\s+/).length > 3 && t.length > printWidth - contIndentWidth,
  );
  if (allFit && !hasLongProse) {
    return { lines: commentLines, nextIndex: end };
  }

  const available = printWidth - contIndentWidth;
  if (available < 10) {
    return { lines: commentLines, nextIndex: end };
  }

  const reflowed = reflowParagraphs(innerTexts, available);

  // Rebuild the docstring
  const resultLines: string[] = [indent + delim];
  for (const rl of reflowed) {
    resultLines.push(rl === "" ? "" : contIndent + rl);
  }
  resultLines.push(indent + delim);

  return { lines: resultLines, nextIndex: end };
}

// ---------------------------------------------------------------------------
// Paragraph grouping and reflow
// ---------------------------------------------------------------------------

/**
 * Group lines into paragraphs (separated by empty lines or structured lines),
 * word-wrap each paragraph, and return the reflowed lines.
 */
function reflowParagraphs(textLines: string[], available: number): string[] {
  const result: string[] = [];
  let paragraph: string[] = [];
  let inCodeBlock = false;

  function flushParagraph(): void {
    if (paragraph.length === 0) return;
    const joined = paragraph.join(" ");
    const wrapped = wordWrap(joined, available);
    result.push(...wrapped);
    paragraph = [];
  }

  for (const text of textLines) {
    // Track fenced code blocks
    if (text.trimStart().startsWith("```")) {
      flushParagraph();
      inCodeBlock = !inCodeBlock;
      result.push(text);
      continue;
    }

    // Inside a code block — pass through unchanged
    if (inCodeBlock) {
      result.push(text);
      continue;
    }

    // Empty line = paragraph boundary
    if (text.trim() === "") {
      flushParagraph();
      result.push("");
      continue;
    }

    // Structured lines (lists, headings, tags, etc.) — standalone paragraph
    if (shouldSkipLine(text)) {
      flushParagraph();
      result.push(text);
      continue;
    }

    // Normal prose — accumulate into current paragraph
    paragraph.push(text.trim());
  }

  flushParagraph();
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * If `line` is a decorative separator (e.g. `// -----` or `# =====`),
 * truncate or expand the repeated character so the line fits exactly
 * at `printWidth`. Returns `undefined` if the line is not a separator.
 */
function truncateSeparator(
  line: string,
  fullPrefix: string,
  printWidth: number,
): string | undefined {
  const text = line.slice(fullPrefix.length);
  // Must be 3+ repeated dashes or equals with optional trailing whitespace
  const sepMatch = text.match(/^([-=])\1{2,}\s*$/);
  if (!sepMatch) return undefined;
  const char = sepMatch[1] ?? "-";
  const fillLen = printWidth - fullPrefix.length;
  if (fillLen < 3) return line;
  return fullPrefix + char.repeat(fillLen);
}
