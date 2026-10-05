import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { z } from "zod";
import type { ComparisonInput, Snapshot } from "../rpc";

/** Argument-array invocation; file content is never passed through a shell. */
export async function git(
  directory: string,
  args: string[],
  signal?: AbortSignal,
) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
    signal,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args[0]}: ${stderr.trim()}`);
  return stdout;
}

const synthetic = new Set(["INDEX", "WORKTREE"]);

export function buildDiffArgs(from: string, to: string) {
  if (from === "INDEX" && to === "WORKTREE") return ["diff"];
  if (synthetic.has(from))
    throw new Error(`Unsupported comparison: ${from} → ${to}`);
  if (to === "WORKTREE") return ["diff", from];
  if (to === "INDEX") return ["diff", "--cached", from];
  return ["diff", from, to];
}

async function pin(directory: string, ref: string, signal?: AbortSignal) {
  if (synthetic.has(ref)) return ref;
  if (ref.startsWith("-") || !/^[a-zA-Z0-9/_.~^{}@-]+$/.test(ref)) {
    throw new Error(`Invalid Git ref: ${ref}`);
  }
  return (
    await git(directory, ["rev-parse", "--verify", `${ref}^{commit}`], signal)
  ).trim();
}

async function content(
  directory: string,
  ref: string,
  path: string,
  signal?: AbortSignal,
) {
  if (ref === "WORKTREE") {
    try {
      return await readFile(resolve(directory, path), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return "";
      throw error;
    }
  }
  const spec = ref === "INDEX" ? `:${path}` : `${ref}:${path}`;
  // Missing files represent additions/deletions, other read failures must surface.
  const exists = Bun.spawn(["git", "cat-file", "-e", spec], {
    cwd: directory,
    stdout: "ignore",
    stderr: "ignore",
    signal,
  });
  if ((await exists.exited) !== 0) return "";
  return git(directory, ["show", spec], signal);
}

export async function captureComparison(
  input: z.infer<typeof ComparisonInput>,
  signal?: AbortSignal,
): Promise<z.infer<typeof Snapshot>> {
  if (!isAbsolute(input.workdir)) throw new Error("workdir must be absolute");
  const repoRoot = (
    await git(input.workdir, ["rev-parse", "--show-toplevel"], signal)
  ).trim();
  const [base, resolvedTo] = await Promise.all([
    pin(repoRoot, input.from, signal),
    pin(repoRoot, input.mode === "committed" ? "HEAD" : input.to, signal),
  ]);
  if (input.mode !== "refs" && synthetic.has(base))
    throw new Error("A branch comparison needs a commit ref");
  const resolvedFrom =
    input.mode === "refs"
      ? base
      : (await git(repoRoot, ["merge-base", base, "HEAD"], signal)).trim();
  const args = buildDiffArgs(resolvedFrom, resolvedTo);
  const filter = input.path ? [input.path] : [];
  // Disable rename folding so both paths are captured completely. -z preserves odd filenames.
  const numstat = await git(
    repoRoot,
    [...args, "--no-renames", "--numstat", "-z", "--", ...filter],
    signal,
  );
  const files = numstat
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(row);
      if (!match?.[3]) throw new Error("Invalid Git numstat record");
      if (match[1] === "-")
        throw new Error(`Binary file cannot be formatted: ${match[3]}`);
      return {
        filePath: match[3],
        additions: Number(match[1]),
        deletions: Number(match[2]),
      };
    });
  if (resolvedTo === "WORKTREE") {
    const untracked = await git(
      repoRoot,
      ["ls-files", "--others", "--exclude-standard", "-z", "--", ...filter],
      signal,
    );
    for (const filePath of untracked.split("\0").filter(Boolean)) {
      if (!files.some((file) => file.filePath === filePath)) {
        const text = await content(repoRoot, "WORKTREE", filePath, signal);
        files.push({
          filePath,
          additions: text ? text.replace(/\n$/, "").split("\n").length : 0,
          deletions: 0,
        });
      }
    }
  }
  const captured = [];
  for (const file of files) {
    const [beforeContent, afterContent] = await Promise.all([
      content(repoRoot, resolvedFrom, file.filePath, signal),
      content(repoRoot, resolvedTo, file.filePath, signal),
    ]);
    captured.push({ ...file, beforeContent, afterContent });
  }
  return {
    id: randomUUID(),
    fromRef:
      input.mode === "refs" ? input.from : `merge-base(${input.from}, HEAD)`,
    toRef: input.mode === "committed" ? "HEAD" : input.to,
    resolvedFrom,
    resolvedTo,
    repoRoot,
    createdAt: Date.now(),
    files: captured,
  };
}
