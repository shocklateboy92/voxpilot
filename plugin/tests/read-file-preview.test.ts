import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_CODE_PREVIEW_LENGTH,
  MAX_IMAGE_PREVIEW_BYTES,
} from "../src/file-preview";
import { readFilePreview } from "../src/services/read-file-preview";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "voxpilot-file-preview-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
  "hex",
);

test("detects images by bytes rather than extension", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
  const path = join(directory, "drawing");
  await writeFile(path, svg);
  expect(await readFilePreview(path)).toEqual({
    image: { mime: "image/svg+xml", size: Buffer.byteLength(svg) },
  });
  const mislabeled = join(directory, "plain.png");
  await writeFile(mislabeled, "Just text\n");
  expect(await readFilePreview(mislabeled)).toEqual({ text: "Just text\n" });
  await expect(
    readFilePreview(mislabeled, { imageOnly: true }),
  ).rejects.toThrow("not recognized as an image");
});

test("only checks for NUL within the first 8,000 bytes", async () => {
  const path = join(directory, "config");
  await writeFile(path, `${"a".repeat(7_999)}\0`);
  await expect(readFilePreview(path)).rejects.toThrow("binary data");
  const text = `${"a".repeat(8_000)}\0`;
  await writeFile(path, text);
  expect(await readFilePreview(path)).toEqual({ text });
});

test("strictly decodes UTF-8 across chunks and through EOF", async () => {
  const path = join(directory, "notes.md");
  const long = "a".repeat(1024 * 1024 - 1);
  await writeFile(path, `\uFEFF${long}é`);
  expect(await readFilePreview(path)).toEqual({ text: `${long}é` });
  await writeFile(
    path,
    Buffer.concat([Buffer.from(`${long}é`), Buffer.from([0xe2, 0x82])]),
  );
  await expect(readFilePreview(path)).rejects.toThrow("UTF-8");
});

test("rejects oversized files with the limit for their kind", async () => {
  const markdown = join(directory, "large.md");
  await writeFile(markdown, "");
  await truncate(markdown, 1024 ** 3);
  await expect(readFilePreview(markdown)).rejects.toThrow("5 MiB");
  const sparseMarkdown = join(directory, "medium.md");
  await writeFile(sparseMarkdown, "# Title\n");
  await truncate(sparseMarkdown, 10 * 1024 * 1024);
  await expect(readFilePreview(sparseMarkdown)).rejects.toThrow("5 MiB");
  const config = join(directory, "config");
  await writeFile(config, "a".repeat(MAX_CODE_PREVIEW_LENGTH + 1));
  await expect(readFilePreview(config)).rejects.toThrow("too large");
  const image = join(directory, "large.png");
  await writeFile(image, PNG);
  await truncate(image, MAX_IMAGE_PREVIEW_BYTES + 1);
  await expect(readFilePreview(image)).rejects.toThrow("20 MiB");
});

test("rejects non-regular files and relative paths", async () => {
  await expect(readFilePreview("config")).rejects.toThrow("absolute file path");
  const folder = join(directory, "folder");
  await mkdir(folder);
  await expect(readFilePreview(folder)).rejects.toThrow("regular files");
});
