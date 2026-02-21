import { z } from "zod/v4";
import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import { type Tool, type ToolResult, resolvePath, simpleResult } from "./base";

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

const MAX_MATCHES = 200;
const MAX_LINE_LENGTH = 500;

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".pyc",
  ".pyo",
  ".class",
  ".jar",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wav",
]);

const parameters = z
  .object({
    pattern: z
      .string()
      .describe("Regular expression pattern to search for."),
    path: z
      .string()
      .optional()
      .describe(
        "Subdirectory to search within (relative to working directory). " +
          "Defaults to '.' (entire working directory).",
      ),
    include: z
      .string()
      .optional()
      .describe(
        "Glob pattern to filter files (e.g., '*.py', '*.ts'). " +
          "If omitted, searches all text files.",
      ),
  })
  .strict();

type Params = z.infer<typeof parameters>;

export class GrepSearchTool implements Tool<typeof parameters> {
  readonly name = "grep_search";
  readonly description =
    "Search for a regex pattern in file contents within the working directory. " +
    "Returns matching lines with file paths and line numbers. " +
    "Optionally restrict to a subdirectory and/or glob file pattern.";
  readonly parameters = parameters;
  readonly requiresConfirmation = false;

  async execute(args: Params, workDir: string): Promise<ToolResult> {
    const patternStr = args.pattern;
    if (!patternStr) {
      return simpleResult("Error: 'pattern' argument is required.");
    }

    let regex: RegExp;
    try {
      regex = new RegExp(patternStr, "i");
    } catch (exc) {
      return simpleResult(
        `Error: invalid regex pattern '${patternStr}': ${exc}`,
      );
    }

    const rawPath =
      args.path && args.path !== "" ? args.path : ".";

    const resolved = await resolvePath(rawPath, workDir);
    if (resolved === null) {
      return simpleResult(
        `Error: path '${rawPath}' is outside the working directory.`,
      );
    }

    try {
      await stat(resolved);
    } catch {
      return simpleResult(`Error: path '${rawPath}' does not exist.`);
    }

    const include = args.include;
    const absWorkDir = resolve(workDir);
    const files = await this.walkFiles(resolved, include);
    const matches: string[] = [];
    let filesSearched = 0;

    for (const filePath of files) {
      filesSearched++;
      let text: string;
      try {
        text = await readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const rel = relative(absWorkDir, filePath);
      const lines = text.split("\n");
      for (let lineNo = 0; lineNo < lines.length; lineNo++) {
        const line = lines[lineNo];
        if (line !== undefined && regex.test(line)) {
          let display = line.slice(0, MAX_LINE_LENGTH);
          if (line.length > MAX_LINE_LENGTH) {
            display += "...";
          }
          matches.push(`${rel}:${lineNo + 1}: ${display}`);
          if (matches.length >= MAX_MATCHES) {
            matches.push(`... (truncated at ${MAX_MATCHES} matches)`);
            return simpleResult(
              this.formatResult(patternStr, matches, filesSearched),
            );
          }
        }
      }
    }

    return simpleResult(this.formatResult(patternStr, matches, filesSearched));
  }

  private async walkFiles(
    root: string,
    include: string | undefined,
  ): Promise<string[]> {
    const files: string[] = [];

    let rootStat: Awaited<ReturnType<typeof stat>>;
    try {
      rootStat = await stat(root);
    } catch {
      return files;
    }

    if (rootStat.isFile()) {
      files.push(root);
      return files;
    }

    const includeGlob = include ? new Bun.Glob(include) : undefined;
    await this.walkDir(root, files, includeGlob);
    files.sort();
    return files;
  }

  private async walkDir(
    dir: string,
    files: string[],
    includeGlob: InstanceType<typeof Bun.Glob> | undefined,
  ): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await this.walkDir(join(dir, entry.name), files, includeGlob);
      } else if (entry.isFile()) {
        if (this.isLikelyBinary(entry.name)) continue;
        if (includeGlob && !includeGlob.match(entry.name)) continue;
        files.push(join(dir, entry.name));
      }
    }
  }

  private isLikelyBinary(name: string): boolean {
    return BINARY_EXTENSIONS.has(extname(name).toLowerCase());
  }

  private formatResult(
    pattern: string,
    matches: string[],
    filesSearched: number,
  ): string {
    if (matches.length === 0) {
      return `No matches found for pattern '${pattern}' (${filesSearched} files searched).`;
    }
    const header = `Found ${matches.length} match(es) for '${pattern}' (${filesSearched} files searched):\n`;
    return header + matches.join("\n");
  }
}
