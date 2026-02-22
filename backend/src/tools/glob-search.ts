import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod/v4";
import { resolvePath, simpleResult, type Tool, type ToolResult } from "./base";

const SKIP_DIRS = new Set([
  ".git",
  "__pycache__",
  "node_modules",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
]);

const MAX_RESULTS = 500;

const parameters = z
  .object({
    pattern: z
      .string()
      .describe(
        "Glob pattern to match files (e.g., '**/*.py', 'src/**/*.ts').",
      ),
    path: z
      .string()
      .optional()
      .describe(
        "Subdirectory to search within (relative to working directory). " +
          "Defaults to '.' (entire working directory).",
      ),
  })
  .strict();

type Params = z.infer<typeof parameters>;

export class GlobSearchTool implements Tool<typeof parameters> {
  readonly name = "glob_search";
  readonly description =
    "Find files matching a glob pattern within the working directory. " +
    "Returns matching file paths relative to the working directory. " +
    "Use '**/' for recursive matching (e.g., '**/*.py' finds all Python files).";
  readonly parameters = parameters;
  readonly requiresConfirmation = false;

  async execute(args: Params, workDir: string): Promise<ToolResult> {
    const pattern = args.pattern;
    if (!pattern) {
      return simpleResult("Error: 'pattern' argument is required.");
    }

    const rawPath = args.path && args.path !== "" ? args.path : ".";

    const resolved = await resolvePath(rawPath, workDir);
    if (resolved === null) {
      return simpleResult(
        `Error: path '${rawPath}' is outside the working directory.`,
      );
    }

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(resolved);
    } catch {
      return simpleResult(`Error: path '${rawPath}' does not exist.`);
    }

    if (!st.isDirectory()) {
      return simpleResult(`Error: '${rawPath}' is not a directory.`);
    }

    const absWorkDir = resolve(workDir);
    const allFiles = await this.collectFiles(resolved);
    const glob = new Bun.Glob(pattern);

    const results: string[] = [];
    for (const filePath of allFiles) {
      const rel = relative(resolved, filePath);
      if (glob.match(rel)) {
        const workRel = relative(absWorkDir, filePath);
        results.push(workRel);
        if (results.length >= MAX_RESULTS) {
          results.push(`... (truncated at ${MAX_RESULTS} results)`);
          break;
        }
      }
    }

    if (results.length === 0) {
      return simpleResult(`No files found matching pattern '${pattern}'.`);
    }

    const header = `Found ${results.length} file(s) matching '${pattern}':\n`;
    return simpleResult(header + results.join("\n"));
  }

  private async collectFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    await this.walkDir(root, files);
    files.sort();
    return files;
  }

  private async walkDir(dir: string, files: string[]): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await this.walkDir(join(dir, entry.name), files);
      } else if (entry.isFile()) {
        files.push(join(dir, entry.name));
      }
    }
  }
}
