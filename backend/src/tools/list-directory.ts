import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
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

const MAX_ENTRIES = 500;

const parameters = z
  .object({
    path: z
      .string()
      .optional()
      .describe(
        "Directory path relative to the working directory. " +
          "Defaults to '.' (the working directory itself).",
      ),
  })
  .strict();

type Params = z.infer<typeof parameters>;

export class ListDirectoryTool implements Tool<typeof parameters> {
  readonly name = "list_directory";
  readonly description =
    "List the contents of a directory relative to the working directory. " +
    "Returns file and subdirectory names (directories end with '/'). " +
    "Common noise directories (.git, __pycache__, node_modules, etc.) are skipped.";
  readonly parameters = parameters;
  readonly requiresConfirmation = false;

  async execute(args: Params, workDir: string): Promise<ToolResult> {
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
      return simpleResult(`Error: directory '${rawPath}' does not exist.`);
    }

    if (!st.isDirectory()) {
      return simpleResult(`Error: '${rawPath}' is not a directory.`);
    }

    let entries: Dirent[];
    try {
      entries = (await readdir(resolved, {
        withFileTypes: true,
        encoding: "utf-8",
      })) as Dirent[];
    } catch (exc) {
      return simpleResult(`Error listing '${rawPath}': ${exc}`);
    }

    // Sort: dirs first, then files, case-insensitive name
    entries.sort((a, b) => {
      const aIsDir = a.isDirectory() ? 0 : 1;
      const bIsDir = b.isDirectory() ? 0 : 1;
      if (aIsDir !== bIsDir) return aIsDir - bIsDir;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    const lines: string[] = [];
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) && entry.isDirectory()) {
        continue;
      }
      if (entry.isDirectory()) {
        lines.push(`${entry.name}/`);
      } else {
        lines.push(entry.name);
      }
      if (lines.length >= MAX_ENTRIES) {
        lines.push(`... (truncated at ${MAX_ENTRIES} entries)`);
        break;
      }
    }

    if (lines.length === 0) {
      return simpleResult(`Directory '${rawPath}' is empty.`);
    }

    const absWorkDir = resolve(workDir);
    const rel = relative(absWorkDir, resolved);
    const header = `Directory: ${rel || "."}/\n`;
    return simpleResult(header + lines.join("\n"));
  }
}
