import type { ImagePreviewInfo } from "@plugin/rpc";
import { fetchPreviewFile } from "../../platform/connection";
import { rpc } from "../../platform/rpc";
import { fileReadRequest } from "./file-state";

export async function readImageBlob(
  path: string,
  info: ImagePreviewInfo,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await fetchPreviewFile(
    fileReadRequest({ path }),
    info.size,
    signal,
  );
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Unable to download this image. Try refreshing the file.");
  }

  const changed = () =>
    new Error("This image changed while loading. Try refreshing the file.");
  const length = response.headers.get("content-length");
  const range = response.headers.get("content-range");
  if (
    (length !== null && Number(length) !== info.size) ||
    (range !== null && range !== `bytes 0-${info.size - 1}/${info.size}`)
  ) {
    await response.body.cancel();
    throw changed();
  }

  // The file may have grown since the plugin inspected it, and older hosts may
  // ignore Range. Never buffer more than the plugin approved.
  const reader = response.body.getReader();
  const bytes = new Uint8Array(info.size);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > info.size) throw changed();
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    await reader.cancel();
  }
  if (offset !== info.size) throw changed();
  return new Blob([bytes], { type: info.mime });
}

export async function readEmbeddedImage(path: string, signal: AbortSignal) {
  const result = await rpc.readFilePreview(
    { path, imageOnly: true },
    { signal },
  );
  if ("image" in result) return readImageBlob(path, result.image, signal);
  throw new Error("error" in result ? result.error : "This is not an image.");
}
