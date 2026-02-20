import type { ChatCompletionTool, FunctionDefinition } from "openai/resources";
import type { Tool, ToolResult } from "./base";
import { simpleResult } from "./base";
import { runGit, ensureGitRepo } from "./git-utils";

/**
 * Valid characters for a git ref: alphanumeric, `/`, `.`, `_`, `-`, `~`, `^`, `{`, `}`, `@`.
 * Rejects anything that could be a shell metacharacter or flag injection.
 */
const SAFE_REF_PATTERN = /^[a-zA-Z0-9/_.\-~^{}@]+$/;

/** Synthetic refs that are NOT real git refs. */
const SYNTHETIC_REFS = new Set(["INDEX", "WORKTREE"]);

/**
 * Shows a diff between two states of the git repository.
 *
 * The `from` and `to` parameters accept:
 *   - Any git ref (HEAD, branch, tag, SHA, HEAD~2, etc.)
 *   - `INDEX` — the staging area (git index)
 *   - `WORKTREE` — the working directory on disk
 *
 * - `displayResult` contains the full unified diff (for the user).
 * - `llmResult` contains only the stat summary (file list + counts).
 */
export class GitDiffTool implements Tool {
  readonly requiresConfirmation = false;

  readonly definition: FunctionDefinition = {
    name: "git_diff",
    description:
      "Show the diff between two states of the git repository. " +
      "Use `from` and `to` to specify what to compare. " +
      "Special refs: INDEX (staging area), WORKTREE (working directory). " +
      "Common patterns: " +
      "from=HEAD to=WORKTREE (uncommitted changes), " +
      "from=HEAD to=INDEX (staged changes), " +
      "from=INDEX to=WORKTREE (unstaged changes), " +
      "from=HEAD~1 to=HEAD (last commit's changes). " +
      "If omitted, defaults to from=INDEX to=WORKTREE (like 'git diff').",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description:
            "The base state to compare from. " +
            "A git ref (HEAD, branch, tag, SHA, HEAD~2), INDEX (staging area), or WORKTREE (working directory). " +
            "Defaults to INDEX.",
        },
        to: {
          type: "string",
          description:
            "The target state to compare to. " +
            "A git ref, INDEX, or WORKTREE. " +
            "Defaults to WORKTREE.",
        },
        path: {
          type: "string",
          description:
            "Restrict diff to a specific file or directory (relative to the working directory). " +
            "Omit to show all changes.",
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

    const from = typeof args.from === "string" && args.from !== "" ? args.from : "INDEX";
    const to = typeof args.to === "string" && args.to !== "" ? args.to : "WORKTREE";
    const path = typeof args.path === "string" && args.path !== "" ? args.path : undefined;

    // Validate refs
    for (const ref of [from, to]) {
      if (!SYNTHETIC_REFS.has(ref) && (ref.startsWith("-") || !SAFE_REF_PATTERN.test(ref))) {
        return simpleResult(
          `Error: invalid ref '${ref}'. ` +
          "Use a git ref (HEAD, branch, SHA, etc.), INDEX, or WORKTREE.",
        );
      }
    }

    if (from === to) {
      return simpleResult("Error: 'from' and 'to' must be different.");
    }

    // Build git diff args based on from/to combinations
    const baseArgs: string[] = ["diff"];

    if (from === "INDEX" && to === "WORKTREE") {
      // git diff (index vs worktree) — default
    } else if (from === "HEAD" && to === "INDEX") {
      // git diff --staged (HEAD vs index)
      baseArgs.push("--staged");
    } else if (from === "INDEX" && to !== "WORKTREE") {
      // git diff --staged <to> — index vs a commit
      baseArgs.push("--staged", to);
    } else if (from !== "INDEX" && from !== "WORKTREE" && to === "WORKTREE") {
      // git diff <from> (commit vs worktree)
      baseArgs.push(from);
    } else if (from !== "INDEX" && from !== "WORKTREE" && to === "INDEX") {
      // git diff --staged <from> (from vs index, reversed direction)
      baseArgs.push("--staged", from);
    } else if (!SYNTHETIC_REFS.has(from) && !SYNTHETIC_REFS.has(to)) {
      // git diff <from> <to> (two commits)
      baseArgs.push(from, to);
    } else {
      return simpleResult(
        `Error: unsupported diff combination from=${from} to=${to}.`,
      );
    }

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
      const suffix = path ? ` in '${path}'` : "";
      return simpleResult(`No changes found between ${from} and ${to}${suffix}.`);
    }

    const label = `Diff ${from} → ${to}`;
    const llmResult = `${label}:\n${statOutput}`;
    const displayResult = `${label}:\n${statOutput}\n\n${diffOutput}`;

    return { llmResult, displayResult };
  }
}
