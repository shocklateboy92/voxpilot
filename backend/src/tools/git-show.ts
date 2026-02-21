import { z } from "zod/v4";
import type { Tool, ToolResult } from "./base";
import { simpleResult } from "./base";
import { ensureGitRepo, runGit } from "./git-utils";

/**
 * Valid characters for a git commit ref: alphanumeric, `/`, `.`, `_`, `-`, `~`, `^`, `{`, `}`.
 * Rejects anything that could be a shell metacharacter or flag injection.
 */
const SAFE_REF_PATTERN = /^[a-zA-Z0-9/_.\-~^{}@]+$/;

/**
 * Shows the metadata, stat summary, and diff for a specific git commit.
 *
 * - `displayResult` contains the full `git show` output (metadata + stat + patch).
 * - `llmResult` contains only metadata and stat summary (no patch).
 */

export const gitShowParameters = z
  .object({
    commit: z
      .string()
      .optional()
      .describe(
        "Commit reference (SHA, branch, tag, HEAD~2, etc.). Defaults to HEAD.",
      ),
  })
  .strict();

type Params = z.infer<typeof gitShowParameters>;

export class GitShowTool implements Tool<typeof gitShowParameters> {
  readonly name = "git_show";
  readonly description =
    "Show the details of a git commit: author, date, message, and the full diff. " +
    "Defaults to the most recent commit (HEAD). " +
    "Accepts a commit SHA, branch name, tag, or other git ref.";
  readonly parameters = gitShowParameters;
  readonly requiresConfirmation = false;

  async execute(args: Params, workDir: string): Promise<ToolResult> {
    const repoCheck = await ensureGitRepo(workDir);
    if ("error" in repoCheck) {
      return simpleResult(`Error: ${repoCheck.error}`);
    }

    const commit = args.commit && args.commit !== "" ? args.commit : "HEAD";

    // Validate the ref to prevent flag injection or shell metacharacters
    if (commit.startsWith("-") || !SAFE_REF_PATTERN.test(commit)) {
      return simpleResult(
        `Error: invalid commit reference '${commit}'. ` +
          "Only alphanumeric characters, '/', '.', '_', '-', '~', '^', '@', '{', '}' are allowed.",
      );
    }

    // Get metadata + stat (no patch)
    const statResult = await runGit(
      ["show", "--stat", "--format=medium", commit],
      workDir,
    );
    if (statResult.exitCode !== 0) {
      return simpleResult(
        `Error: git show failed: ${statResult.stderr.trim()}`,
      );
    }
    // Strip the patch from the stat output: stat output ends before the first "diff --git" line
    const statLines = statResult.stdout.trim().split("\n");
    const diffIdx = statLines.findIndex((l) => l.startsWith("diff --git"));
    const statOutput =
      diffIdx >= 0
        ? statLines.slice(0, diffIdx).join("\n").trim()
        : statResult.stdout.trim();

    // Get full output with patch
    const fullResult = await runGit(
      ["show", "--stat", "--patch", "--format=medium", commit],
      workDir,
    );
    if (fullResult.exitCode !== 0) {
      return simpleResult(
        `Error: git show failed: ${fullResult.stderr.trim()}`,
      );
    }
    const fullOutput = fullResult.stdout.trim();

    return {
      llmResult: statOutput,
      displayResult: fullOutput,
    };
  }
}
