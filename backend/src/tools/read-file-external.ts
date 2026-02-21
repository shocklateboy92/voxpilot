import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod/v4";
import { simpleResult, type Tool, type ToolResult } from "./base";

const MAX_FILE_SIZE = 100_000;

const parameters = z
  .object({
    path: z
      .string()
      .describe(
        "Absolute file path (e.g. /etc/hosts, /home/user/other-project/file.py).",
      ),
    start_line: z
      .number()
      .int()
      .optional()
      .describe(
        "First line to read (1-based, inclusive). Omit to start from the beginning.",
      ),
    end_line: z
      .number()
      .int()
      .optional()
      .describe(
        "Last line to read (1-based, inclusive). Omit to read to the end.",
      ),
  })
  .strict();

type Params = z.infer<typeof parameters>;

export class ReadFileExternalTool implements Tool<typeof parameters> {
  readonly name = "read_file_external";
  readonly description =
    "Read a file anywhere on the filesystem by absolute path. " +
    "Use this when you need to read files outside the project working directory " +
    "(e.g. system config files, files in other projects). " +
    "Requires user approval before execution. " +
    "Returns the file contents with line numbers.";
  readonly parameters = parameters;
  readonly requiresConfirmation = true;

  async execute(args: Params, _workDir: string): Promise<ToolResult> {
    const rawPath = args.path;
    if (!rawPath) {
      return simpleResult("Error: 'path' argument is required.");
    }

    const resolved = resolve(rawPath);

    if (!isAbsolute(rawPath)) {
      return simpleResult(`Error: path '${rawPath}' must be absolute.`);
    }

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(resolved);
    } catch {
      return simpleResult(`Error: file '${rawPath}' does not exist.`);
    }

    if (!st.isFile()) {
      return simpleResult(`Error: '${rawPath}' is not a file.`);
    }

    if (st.size > MAX_FILE_SIZE) {
      return simpleResult(
        `Error: file '${rawPath}' is ${st.size.toLocaleString()} bytes ` +
          `(limit is ${MAX_FILE_SIZE.toLocaleString()} bytes). ` +
          "Use start_line/end_line to read a portion.",
      );
    }

    let text: string;
    try {
      text = await readFile(resolved, "utf-8");
    } catch (exc) {
      return simpleResult(`Error reading '${rawPath}': ${exc}`);
    }

    const lines = text.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    const total = lines.length;

    let start = args.start_line ?? 1;
    let end = args.end_line ?? total;

    start = Math.max(1, start);
    end = Math.min(total, end);

    if (start > end) {
      return simpleResult(
        `Error: start_line (${start}) > end_line (${end}). File has ${total} lines.`,
      );
    }

    const selected = lines.slice(start - 1, end);
    const width = String(end).length;
    const numbered = selected.map(
      (line, i) => `${String(start + i).padStart(width)} | ${line}`,
    );
    const header = `File: ${rawPath} (lines ${start}-${end} of ${total})\n`;
    return simpleResult(header + numbered.join("\n"));
  }
}
