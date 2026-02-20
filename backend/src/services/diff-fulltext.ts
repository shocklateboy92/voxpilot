/**
 * Resolve post-change full file text from git blobs.
 *
 * Uses the `toRef` to determine where to read from:
 *   - `WORKTREE` — read from the filesystem
 *   - `INDEX` — read from the git index via `git show :path`
 *   - Any other ref — read from the git tree via `git show ref:path`
 */

import { runGit } from "../tools/git-utils";

/** Maximum bytes of full text to store per file. */
const MAX_FULL_TEXT_BYTES = 500_000;

export interface FullTextResult {
  available: boolean;
  content: string | null;
  lineCount: number | null;
}

/**
 * Resolve post-change file content for a diff file.
 *
 * @param filePath - Repo-relative path.
 * @param toRef - The "to" side of the diff: WORKTREE, INDEX, or a commit ref.
 * @param workDir - Repository working directory.
 */
export async function resolveFullText(
  filePath: string,
  toRef: string,
  workDir: string,
): Promise<FullTextResult> {
  try {
    if (toRef === "WORKTREE") {
      // Read from the filesystem
      try {
        const file = Bun.file(`${workDir}/${filePath}`);
        const content = await file.text();
        if (content.length > MAX_FULL_TEXT_BYTES) {
          return { available: false, content: null, lineCount: null };
        }
        const lineCount = content.split("\n").length;
        return { available: true, content, lineCount };
      } catch {
        return { available: false, content: null, lineCount: null };
      }
    }

    // INDEX or a commit ref — use git show
    const gitRef = toRef === "INDEX" ? `:${filePath}` : `${toRef}:${filePath}`;
    const result = await runGit(["show", gitRef], workDir);

    if (result.exitCode !== 0) {
      return { available: false, content: null, lineCount: null };
    }

    const content = result.stdout;
    if (content.length > MAX_FULL_TEXT_BYTES) {
      return { available: false, content: null, lineCount: null };
    }

    const lineCount = content.split("\n").length;
    return { available: true, content, lineCount };
  } catch {
    return { available: false, content: null, lineCount: null };
  }
}
