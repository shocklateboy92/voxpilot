export const MAX_CODE_PREVIEW_LENGTH = 100_000;

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}
