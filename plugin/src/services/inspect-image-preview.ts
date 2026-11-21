import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { MAX_IMAGE_PREVIEW_BYTES } from "../file-preview";
import { ImagePreviewInfo } from "../rpc";

const MAX_SNIFF_BYTES = 1024 * 1024;

export async function inspectImagePreview(path: string, signal?: AbortSignal) {
  if (!isAbsolute(path) || path.includes("\0"))
    throw new Error("A preview requires an absolute file path.");
  signal?.throwIfAborted();
  if (!(await stat(path)).isFile())
    throw new Error("Only regular files can be previewed.");

  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Only regular files can be previewed.");
    if (info.size > MAX_IMAGE_PREVIEW_BYTES)
      throw new Error("This file is too large to preview (maximum 20 MiB).");
    if (!info.size) return;

    const sample = Buffer.allocUnsafe(Math.min(info.size, MAX_SNIFF_BYTES));
    let offset = 0;
    while (offset < sample.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(
        sample,
        offset,
        sample.length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (!offset) return;

    // Stdin keeps classification content-based and bounds what file can read.
    let proc: ReturnType<typeof spawnFile>;
    try {
      proc = spawnFile(sample.subarray(0, offset), signal);
    } catch (error) {
      // Older installs without file can still preview text.
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    signal?.throwIfAborted();
    if (exitCode !== 0) return;
    const result = ImagePreviewInfo.safeParse({
      mime: stdout.trim(),
      size: info.size,
    });
    return result.success ? result.data : undefined;
  } finally {
    await file.close();
  }
}

function spawnFile(sample: Uint8Array<ArrayBuffer>, signal?: AbortSignal) {
  return Bun.spawn(["file", "--brief", "--mime-type", "-"], {
    stdin: new Blob([sample]),
    stdout: "pipe",
    stderr: "ignore",
    signal,
    timeout: 5_000,
  });
}
