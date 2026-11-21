import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { isMarkdownPath, MAX_CODE_PREVIEW_LENGTH } from "../file-preview";

const BINARY_SAMPLE_BYTES = 8_000;
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

export async function readTextPreview(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  // Preview links may explicitly name files outside the current workspace.
  if (!isAbsolute(path) || path.includes("\0"))
    throw new Error("A preview requires an absolute file path.");
  const markdown = isMarkdownPath(path);
  // At most three UTF-8 bytes per UTF-16 code unit, plus an optional BOM.
  const byteLimit = markdown
    ? MAX_MARKDOWN_BYTES
    : 3 * MAX_CODE_PREVIEW_LENGTH + 3;
  const tooLarge = () =>
    new Error(
      markdown
        ? "This file is too large to preview (maximum 5 MiB)."
        : "This file is too large for a formatted preview.",
    );
  const notFile = () => new Error("Only regular files can be previewed.");

  signal?.throwIfAborted();
  if (!(await stat(path)).isFile()) throw notFile();
  // Recheck the opened file; O_NONBLOCK also avoids waiting on a replaced FIFO.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw notFile();
    if (info.size > byteLimit) throw tooLarge();

    const buffer = Buffer.allocUnsafe(BINARY_SAMPLE_BYTES);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const invalidEncoding = () =>
      new Error("Only UTF-8 text files can be previewed.");
    let text = "";
    let offset = 0;
    while (true) {
      signal?.throwIfAborted();
      // Read at most one byte beyond the limit if the file grows after stat().
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, byteLimit + 1 - offset),
        offset,
      );
      if (!bytesRead) break;
      const bytes = buffer.subarray(0, bytesRead);
      if (
        offset < BINARY_SAMPLE_BYTES &&
        bytes.subarray(0, BINARY_SAMPLE_BYTES - offset).includes(0)
      )
        throw new Error("This file contains binary data.");
      offset += bytesRead;
      if (offset > byteLimit) throw tooLarge();
      try {
        text += decoder.decode(bytes, { stream: true });
      } catch {
        throw invalidEncoding();
      }
      if (!markdown && text.length > MAX_CODE_PREVIEW_LENGTH) throw tooLarge();
    }
    signal?.throwIfAborted();
    try {
      // Flush the decoder to reject an incomplete sequence at EOF.
      return text + decoder.decode();
    } catch {
      throw invalidEncoding();
    }
  } finally {
    await file.close();
  }
}
