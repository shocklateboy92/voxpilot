export const MAX_CODE_PREVIEW_LENGTH = 100_000;
export const MAX_IMAGE_PREVIEW_BYTES = 20 * 1024 * 1024;

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}
