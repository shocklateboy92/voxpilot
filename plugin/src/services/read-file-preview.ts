import { constants } from "node:fs";
import { type FileHandle, open, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  formatMiB,
  isMarkdownPath,
  MAX_CODE_PREVIEW_LENGTH,
  MAX_IMAGE_PREVIEW_BYTES,
  MAX_MARKDOWN_PREVIEW_BYTES,
} from "../file-preview";
import { ImagePreviewInfo } from "../rpc";

const MAX_SNIFF_BYTES = 1024 * 1024;
const BINARY_SAMPLE_BYTES = 8_000;
const READ_CHUNK_BYTES = 64 * 1024;

export type FilePreview = { text: string } | { image: ImagePreviewInfo };

/** Classify and read a file through one handle, so it cannot change kind between checks. */
export async function readFilePreview(
  path: string,
  options: { imageOnly?: boolean } = {},
  signal?: AbortSignal,
): Promise<FilePreview> {
  // Preview links may explicitly name files outside the current workspace.
  if (!isAbsolute(path) || path.includes("\0"))
    throw new Error("A preview requires an absolute file path.");
  const notFile = () => new Error("Only regular files can be previewed.");
  signal?.throwIfAborted();
  if (!(await stat(path)).isFile()) throw notFile();
  // Recheck the opened file; O_NONBLOCK also avoids waiting on a replaced FIFO.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw notFile();
    const size = info.size;
    const text = textLimits(path);
    const imageTooLarge = () =>
      new Error(
        `This file is too large to preview (maximum ${formatMiB(MAX_IMAGE_PREVIEW_BYTES)}).`,
      );
    // Skip sniffing files that no preview kind could accept.
    if (size > Math.max(text.bytes, MAX_IMAGE_PREVIEW_BYTES))
      throw text.markdown ? text.tooLarge() : imageTooLarge();

    const sample = await readSample(
      file,
      Math.min(size, MAX_SNIFF_BYTES),
      signal,
    );
    const mime = sample.length ? await sniffMime(sample, signal) : undefined;
    const image = ImagePreviewInfo.shape.mime.safeParse(mime);
    if (image.success) {
      if (size > MAX_IMAGE_PREVIEW_BYTES) throw imageTooLarge();
      return { image: { mime: image.data, size } };
    }
    if (options.imageOnly)
      throw new Error("This file was not recognized as an image.");
    if (size > text.bytes) throw text.tooLarge();
    return { text: await readText(file, sample, text, signal) };
  } finally {
    await file.close();
  }
}

function textLimits(path: string) {
  const markdown = isMarkdownPath(path);
  return {
    markdown,
    // At most three UTF-8 bytes per UTF-16 code unit, plus an optional BOM.
    bytes: markdown
      ? MAX_MARKDOWN_PREVIEW_BYTES
      : 3 * MAX_CODE_PREVIEW_LENGTH + 3,
    tooLarge: () =>
      new Error(
        markdown
          ? `This file is too large to preview (maximum ${formatMiB(MAX_MARKDOWN_PREVIEW_BYTES)}).`
          : "This file is too large for a formatted preview.",
      ),
  };
}

async function readSample(
  file: FileHandle,
  length: number,
  signal?: AbortSignal,
) {
  const sample = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    signal?.throwIfAborted();
    const { bytesRead } = await file.read(
      sample,
      offset,
      length - offset,
      offset,
    );
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return sample.subarray(0, offset);
}

/** Continue from the sniffed sample; the file may have grown since stat(). */
async function readText(
  file: FileHandle,
  sample: Buffer,
  limits: ReturnType<typeof textLimits>,
  signal?: AbortSignal,
): Promise<string> {
  if (sample.subarray(0, BINARY_SAMPLE_BYTES).includes(0))
    throw new Error("This file contains binary data.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const decode = (bytes?: Buffer) => {
    try {
      return bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode();
    } catch {
      throw new Error("Only UTF-8 text files can be previewed.");
    }
  };
  let text = "";
  let offset = 0;
  const append = (bytes: Buffer) => {
    offset += bytes.length;
    if (offset > limits.bytes) throw limits.tooLarge();
    text += decode(bytes);
    if (!limits.markdown && text.length > MAX_CODE_PREVIEW_LENGTH)
      throw limits.tooLarge();
  };
  append(sample);
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  while (true) {
    signal?.throwIfAborted();
    // Read at most one byte beyond the limit if the file grows after stat().
    const { bytesRead } = await file.read(
      buffer,
      0,
      Math.min(buffer.length, limits.bytes + 1 - offset),
      offset,
    );
    if (!bytesRead) break;
    append(buffer.subarray(0, bytesRead));
  }
  signal?.throwIfAborted();
  // Flush the decoder to reject an incomplete sequence at EOF.
  return text + decode();
}

/** Stdin keeps classification content-based and bounds what `file` can read. */
async function sniffMime(sample: Buffer, signal?: AbortSignal) {
  let proc: ReturnType<typeof spawnFile>;
  try {
    proc = spawnFile(sample, signal);
  } catch (error) {
    // Older installs without `file` can still preview text.
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  signal?.throwIfAborted();
  return exitCode === 0 ? stdout.trim() : undefined;
}

function spawnFile(sample: Uint8Array, signal?: AbortSignal) {
  return Bun.spawn(["file", "--brief", "--mime-type", "-"], {
    stdin: new Blob([new Uint8Array(sample)]),
    stdout: "pipe",
    stderr: "ignore",
    signal,
    timeout: 5_000,
  });
}
