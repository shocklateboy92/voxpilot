/**
 * Resolve post-change full file text from git blobs.
 *
 * For unstaged diffs: reads from worktree.
 * For staged diffs: reads from the index via `git show :path`.
 * For commits: reads from the tree blob via `git show commit:path`.
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
 * @param commitRef - Commit ref for `git_show` (null for `git_diff`).
 * @param staged - Whether the diff is staged changes only.
 * @param workDir - Repository working directory.
 */
export async function resolveFullText(
  filePath: string,
  commitRef: string | null,
  staged: boolean,
  workDir: string,
): Promise<FullTextResult> {
  try {
    let result;

    if (commitRef) {
      // For commits: git show <ref>:<path>
      result = await runGit(["show", `${commitRef}:${filePath}`], workDir);
    } else if (staged) {
      // For staged changes: git show :<path> (index)
      result = await runGit(["show", `:${filePath}`], workDir);
    } else {
      // For unstaged changes: read from worktree
      result = await runGit(["show", `HEAD:${filePath}`], workDir);
      if (result.exitCode !== 0) {
        // File might be new and untracked — try reading it directly
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
    }

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
