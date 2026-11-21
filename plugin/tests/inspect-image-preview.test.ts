import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_IMAGE_PREVIEW_BYTES } from "../src/file-preview";
import { inspectImagePreview } from "../src/services/inspect-image-preview";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "voxpilot-image-preview-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("detects images by bytes rather than extension", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
  const path = join(directory, "drawing");
  await writeFile(path, svg);
  expect(await inspectImagePreview(path)).toEqual({
    mime: "image/svg+xml",
    size: Buffer.byteLength(svg),
  });
  const mislabeled = join(directory, "plain.png");
  await writeFile(mislabeled, "Just text\n");
  expect(await inspectImagePreview(mislabeled)).toBeUndefined();
});

test("does not inspect oversized or non-regular files", async () => {
  const path = join(directory, "large.png");
  await writeFile(path, "");
  await truncate(path, MAX_IMAGE_PREVIEW_BYTES + 1);
  await expect(inspectImagePreview(path)).rejects.toThrow("20 MiB");
  const folder = join(directory, "folder");
  await mkdir(folder);
  await expect(inspectImagePreview(folder)).rejects.toThrow("regular files");
});
