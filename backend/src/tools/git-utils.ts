import { resolve } from "node:path";

/** Maximum bytes of stdout captured before truncation. */
const MAX_OUTPUT_BYTES = 100_000;

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a git command inside `workDir`.
 *
 * Captures stdout/stderr as UTF-8 strings and truncates stdout if it
 * exceeds `MAX_OUTPUT_BYTES` to avoid flooding the LLM context.
 */
export async function runGit(
  args: readonly string[],
  workDir: string,
): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: workDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [rawStdout, rawStderr] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
  ]);

  const exitCode = await proc.exited;
  const decoder = new TextDecoder();

  let stdout = decoder.decode(rawStdout);
  if (rawStdout.byteLength > MAX_OUTPUT_BYTES) {
    stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + "\n[output truncated]";
  }

  const stderr = decoder.decode(rawStderr);

  return { stdout, stderr, exitCode };
}

/**
 * Ensure `workDir` is inside a git repository.
 *
 * Returns the repo root on success, or an error string on failure.
 */
export async function ensureGitRepo(
  workDir: string,
): Promise<{ root: string } | { error: string }> {
  const result = await runGit(
    ["rev-parse", "--show-toplevel"],
    workDir,
  );

  if (result.exitCode !== 0) {
    return { error: `'${workDir}' is not inside a git repository.` };
  }

  const root = resolve(result.stdout.trim());
  return { root };
}
