import type { ChatCompletionTool, FunctionDefinition } from "openai/resources";
import type { Tool, ToolResult } from "./base";
import { simpleResult } from "./base";
import { runGit, ensureGitRepo } from "./git-utils";

/**
 * Shows uncommitted changes in the working directory as a unified diff.
 *
 * - `displayResult` contains the full unified diff (for the user).
 * - `llmResult` contains only the stat summary (file list + counts).
 */
export class GitDiffTool implements Tool {
  readonly requiresConfirmation = false;

  readonly definition: FunctionDefinition = {
    name: "git_diff",
    description:
      "Show uncommitted changes in the git repository as a unified diff. " +
      "Displays file-by-file additions and deletions. " +
      "Use 'staged' to see only staged (index) changes. " +
      "Use 'path' to restrict to a specific file or directory.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Restrict diff to a specific file or directory (relative to the working directory). " +
            "Omit to show all changes.",
        },
        staged: {
          type: "boolean",
          description:
            "If true, show only staged changes (equivalent to 'git diff --staged'). " +
            "Defaults to false (unstaged changes).",
        },
      },
      additionalProperties: false,
    },
  };

  toOpenAiTool(): ChatCompletionTool {
    return { type: "function", function: this.definition };
  }

  async execute(
    args: Record<string, unknown>,
    workDir: string,
  ): Promise<ToolResult> {
    const repoCheck = await ensureGitRepo(workDir);
    if ("error" in repoCheck) {
      return simpleResult(`Error: ${repoCheck.error}`);
    }

    const staged = args.staged === true;
    const path = typeof args.path === "string" && args.path !== "" ? args.path : undefined;

    // Build common args
    const baseArgs: string[] = ["diff"];
    if (staged) baseArgs.push("--staged");

    // Get stat summary
    const statArgs = [...baseArgs, "--stat"];
    if (path) statArgs.push("--", path);

    const statResult = await runGit(statArgs, workDir);
    if (statResult.exitCode !== 0) {
      return simpleResult(`Error: git diff failed: ${statResult.stderr.trim()}`);
    }

    const statOutput = statResult.stdout.trim();

    // Get full unified diff
    const diffArgs = [...baseArgs];
    if (path) diffArgs.push("--", path);

    const diffResult = await runGit(diffArgs, workDir);
    if (diffResult.exitCode !== 0) {
      return simpleResult(`Error: git diff failed: ${diffResult.stderr.trim()}`);
    }

    const diffOutput = diffResult.stdout.trim();

    if (!diffOutput && !statOutput) {
      const scope = staged ? "staged" : "uncommitted";
      const suffix = path ? ` in '${path}'` : "";
      return simpleResult(`No ${scope} changes found${suffix}.`);
    }

    const label = staged ? "Staged changes" : "Uncommitted changes";
    const llmResult = `${label}:\n${statOutput}`;
    const displayResult = `${label}:\n${statOutput}\n\n${diffOutput}`;

    return { llmResult, displayResult };
  }
}
