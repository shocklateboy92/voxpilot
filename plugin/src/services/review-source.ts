import { z } from "zod";
import { ReviewLine, ReviewReference, type Snapshot } from "../rpc";
import { sourceLines } from "./source-line-map";

export const ReviewSourceInput = ReviewReference.extend({
  side: ReviewLine.shape.side,
  startLine: z.number().int().positive().default(1),
  endLine: z.number().int().positive().optional(),
}).strict();

const MAX_LINES = 200;
const MAX_CHARS = 16_000;

export function readReviewSource(
  snapshot: z.infer<typeof Snapshot>,
  input: z.infer<typeof ReviewSourceInput>,
): string {
  const file = snapshot.files.find(
    (entry) => entry.filePath === input.filePath,
  );
  if (!file) throw new Error("File not found in the review snapshot.");
  const source =
    input.side === "before" ? file.beforeContent : file.afterContent;
  const heading = `${input.filePath} (${input.side}, snapshot ${snapshot.id})`;
  if (!source) return `${heading}\nNo source text on this side.`;

  const lines = sourceLines(source);
  const start = input.startLine;
  const end = input.endLine ?? lines.length;
  if (start > end || start > lines.length)
    throw new Error(
      `Invalid source range. This side has ${lines.length} lines.`,
    );

  const last = Math.min(end, lines.length, start + MAX_LINES - 1);
  let text = "";
  let included = start - 1;
  for (let line = start; line <= last; line++) {
    const row = `${line}: ${lines[line - 1]}\n`;
    if (text.length + row.length > MAX_CHARS) {
      if (text.length === 0)
        return `${heading}\n${row.slice(0, MAX_CHARS)}\n[Line ${line} truncated.]`;
      break;
    }
    text += row;
    included = line;
  }
  const truncated = included < Math.min(end, lines.length);
  return `${heading}\n${text}${truncated ? `[More source available from line ${included + 1}.]` : ""}`;
}
