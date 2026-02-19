import type { ChatCompletionTool, FunctionDefinition } from "openai/resources";
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Tool } from "./base";
import { resolvePath } from "./base";

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

export class GlobSearchTool implements Tool {
  readonly requiresConfirmation = false;

  readonly definition: FunctionDefinition = {
    name: "glob_search",
    description:
      "Find files matching a glob pattern within the working directory. " +
      "Returns matching file paths relative to the working directory. " +
      "Use '**/' for recursive matching (e.g., '**/*.py' finds all Python files).",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern to match files (e.g., '**/*.py', 'src/**/*.ts').",
        },
        path: {
          type: "string",
          description:
            "Subdirectory to search within (relative to working directory). " +
            "Defaults to '.' (entire working directory).",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  };

  toOpenAiTool(): ChatCompletionTool {
    return { type: "function", function: this.definition };
  }

  async execute(
    args: Record<string, unknown>,
    workDir: string,
  ): Promise<string> {
    const pattern = (args.pattern as string | undefined) ?? "";
    if (!pattern) {
      return "Error: 'pattern' argument is required.";
    }

    const rawPath =
      typeof args.path === "string" && args.path !== "" ? args.path : ".";

    const resolved = await resolvePath(rawPath, workDir);
    if (resolved === null) {
      return `Error: path '${rawPath}' is outside the working directory.`;
    }

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(resolved);
    } catch {
      return `Error: path '${rawPath}' does not exist.`;
    }

    if (!st.isDirectory()) {
      return `Error: '${rawPath}' is not a directory.`;
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
      return `No files found matching pattern '${pattern}'.`;
    }

    const header = `Found ${results.length} file(s) matching '${pattern}':\n`;
    return header + results.join("\n");
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
