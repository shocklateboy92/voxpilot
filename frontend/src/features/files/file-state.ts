import type { FileReadInput } from "@opencode/client";
import { createSignal } from "solid-js";

export type FileRequest = FileReadInput & { fragment?: string };
export const [markdownFile, setMarkdownFile] = createSignal<FileRequest>();

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}

/** Use a file URL only for path resolution; reads still use the authenticated API. */
export function fileUrl(request: FileReadInput): URL {
  const directory = request.location?.directory ?? "/";
  const encodedDirectory = directory
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const base = new URL(`file://${encodedDirectory.replace(/\/$/, "")}/`);
  const path = request.path.split("/").map(encodeURIComponent).join("/");
  return new URL(path, base);
}

export function openMarkdown(path: string, directory: string): void {
  const request = { path, location: { directory } };
  setMarkdownFile({
    ...request,
    path: decodeURIComponent(fileUrl(request).pathname),
  });
}
