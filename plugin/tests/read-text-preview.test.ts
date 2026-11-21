import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_CODE_PREVIEW_LENGTH } from "../src/file-preview";
import { readTextPreview } from "../src/services/read-text-preview";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "voxpilot-text-preview-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("only checks for NUL within the first 8,000 bytes", async () => {
  const path = join(directory, "config");
  await writeFile(path, `${"a".repeat(7_999)}\0`);
  await expect(readTextPreview(path)).rejects.toThrow("binary data");
  const text = `${"a".repeat(8_000)}\0`;
  await writeFile(path, text);
  expect(await readTextPreview(path)).toBe(text);
});

test("strictly decodes UTF-8 across chunks and through EOF", async () => {
  const text = `${"a".repeat(7_999)}é`;
  const path = join(directory, "config");
  await writeFile(path, `\uFEFF${"a".repeat(7_996)}é`);
  expect(await readTextPreview(path)).toBe(`${"a".repeat(7_996)}é`);
  await writeFile(
    path,
    Buffer.concat([Buffer.from(text), Buffer.from([0xe2, 0x82])]),
  );
  await expect(readTextPreview(path)).rejects.toThrow("UTF-8");
});

test("rejects oversized files, non-regular files, and relative paths", async () => {
  const path = join(directory, "large.md");
  await writeFile(path, "");
  await truncate(path, 1024 ** 3);
  await expect(readTextPreview(path)).rejects.toThrow("5 MiB");
  const config = join(directory, "config");
  await writeFile(config, "a".repeat(MAX_CODE_PREVIEW_LENGTH + 1));
  await expect(readTextPreview(config)).rejects.toThrow("too large");
  await expect(readTextPreview("config")).rejects.toThrow("absolute file path");
  const folder = join(directory, "folder");
  await mkdir(folder);
  await expect(readTextPreview(folder)).rejects.toThrow("regular files");
});
