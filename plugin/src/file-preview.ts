const MIB = 1024 * 1024;

export const MAX_CODE_PREVIEW_LENGTH = 100_000;
export const MAX_MARKDOWN_PREVIEW_BYTES = 5 * MIB;
export const MAX_IMAGE_PREVIEW_BYTES = 20 * MIB;

export function formatMiB(bytes: number): string {
  return `${bytes / MIB} MiB`;
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}

/** Lowercase extension of the final path segment, without the dot. */
export function fileExtension(path: string): string {
  return /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
