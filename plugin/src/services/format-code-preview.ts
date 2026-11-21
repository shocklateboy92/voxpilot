import { highlightCode } from "./diff-highlight";
import { renderCodeLine } from "./diff-render";
import { formatCode } from "./format-diff";
import { mapSourceLine, sourceLines } from "./source-line-map";

export async function formatCodePreview(
  input: {
    filePath: string;
    text: string;
    printWidth: number;
    sourceLine?: number;
  },
  signal?: AbortSignal,
) {
  const { text, printWidth, sourceLine } = input;
  // Format stdin as a standalone file; the requested path only selects a language.
  const extension = /\.[a-z\d]+$/i.exec(input.filePath)?.[0] ?? "";
  const fileName = `preview${extension}`;
  const formatted = await formatCode(text, fileName, printWidth, signal);
  const display = formatted.replace(/\r\n?/g, "\n");
  const highlight = await highlightCode(fileName, display);
  signal?.throwIfAborted();
  const target =
    sourceLine === undefined
      ? undefined
      : mapSourceLine(text, formatted, sourceLine);
  const html = sourceLines(display)
    .map((line, index) => {
      const number = index + 1;
      const anchor = number === target ? " data-code-target" : "";
      const code = renderCodeLine(line, highlight?.[index]);
      return `<span data-code-line="${number}"${anchor}>${code}</span>`;
    })
    .join("\n");
  return {
    html: display.endsWith("\n") ? `${html}\n` : html,
    targetFound: target !== undefined,
  };
}
