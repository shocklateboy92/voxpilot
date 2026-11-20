import { diffChars } from "diff";

const MAX_CHARS = 100_000;
const WHITESPACE = /\s/u;

/** Split source into lines, ignoring a trailing line terminator. */
export function sourceLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Index only visible characters, retaining their original line numbers. */
function indexText(text: string) {
  const chars: string[] = [];
  const lines: number[] = [];
  let line = 1;
  for (const char of text.replace(/\r\n?/g, "\n")) {
    if (char === "\n") line++;
    if (WHITESPACE.test(char)) continue;
    chars.push(char);
    lines.push(line);
  }
  return { chars, lines, text: chars.join("") };
}

function matchingOffsets(source: string, display: string, size: number) {
  const changes = diffChars(source, display, { timeout: 50 });
  if (!changes) return undefined;
  const offsets = new Int32Array(size).fill(-1);
  let original = 0;
  let formatted = 0;
  for (const change of changes) {
    const count = change.count;
    if (change.added) formatted += count;
    else if (change.removed) original += count;
    else {
      for (let i = 0; i < count; i++) offsets[original++] = formatted++;
    }
  }
  return offsets;
}

/** Map a raw source line to its first visible character after reformatting. */
export function mapSourceLine(source: string, display: string, line: number) {
  if (source === display) {
    return line >= 1 && line <= sourceLines(source).length ? line : undefined;
  }
  if (Math.max(source.length, display.length) > MAX_CHARS) return undefined;
  const original = indexText(source);
  const formatted = indexText(display);
  const start = original.lines.indexOf(line);
  if (start < 0) return undefined;

  // When only whitespace changed, even identical occurrences have a unique
  // ordinal position. This also handles comments reflowed at a different width.
  if (original.text === formatted.text) return formatted.lines[start];

  const forward = matchingOffsets(
    original.text,
    formatted.text,
    original.chars.length,
  );
  if (!forward) return undefined;
  const backward = matchingOffsets(
    original.chars.toReversed().join(""),
    formatted.chars.toReversed().join(""),
    original.chars.length,
  );
  if (!backward) return undefined;
  // Refuse to guess when the source text did not survive or two alignments
  // disagree on which occurrence it corresponds to.
  for (let i = start; original.lines[i] === line; i++) {
    const match = forward[i];
    const reverse = backward[original.chars.length - 1 - i];
    if (
      match === undefined ||
      match < 0 ||
      reverse === undefined ||
      reverse < 0 ||
      match !== formatted.chars.length - 1 - reverse
    )
      return undefined;
  }
  const target = forward[start];
  return target === undefined ? undefined : formatted.lines[target];
}
