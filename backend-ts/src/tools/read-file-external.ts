import type { ChatCompletionTool, FunctionDefinition } from "openai/resources";
import { stat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Tool } from "./base";

const MAX_FILE_SIZE = 100_000;

export class ReadFileExternalTool implements Tool {
  readonly requiresConfirmation = true;

  readonly definition: FunctionDefinition = {
    name: "read_file_external",
    description:
      "Read a file anywhere on the filesystem by absolute path. " +
      "Use this when you need to read files outside the project working directory " +
      "(e.g. system config files, files in other projects). " +
      "Requires user approval before execution. " +
      "Returns the file contents with line numbers.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute file path (e.g. /etc/hosts, /home/user/other-project/file.py).",
        },
        start_line: {
          type: "integer",
          description:
            "First line to read (1-based, inclusive). Omit to start from the beginning.",
        },
        end_line: {
          type: "integer",
          description:
            "Last line to read (1-based, inclusive). Omit to read to the end.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  };

  toOpenAiTool(): ChatCompletionTool {
    return { type: "function", function: this.definition };
  }

  async execute(
    args: Record<string, unknown>,
    _workDir: string,
  ): Promise<string> {
    const rawPath = (args.path as string | undefined) ?? "";
    if (!rawPath) {
      return "Error: 'path' argument is required.";
    }

    const resolved = resolve(rawPath);

    if (!isAbsolute(rawPath)) {
      return `Error: path '${rawPath}' must be absolute.`;
    }

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(resolved);
    } catch {
      return `Error: file '${rawPath}' does not exist.`;
    }

    if (!st.isFile()) {
      return `Error: '${rawPath}' is not a file.`;
    }

    if (st.size > MAX_FILE_SIZE) {
      return (
        `Error: file '${rawPath}' is ${st.size.toLocaleString()} bytes ` +
        `(limit is ${MAX_FILE_SIZE.toLocaleString()} bytes). ` +
        "Use start_line/end_line to read a portion."
      );
    }

    let text: string;
    try {
      text = await readFile(resolved, "utf-8");
    } catch (exc) {
      return `Error reading '${rawPath}': ${exc}`;
    }

    const lines = text.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    const total = lines.length;

    let start = typeof args.start_line === "number" ? args.start_line : 1;
    let end = typeof args.end_line === "number" ? args.end_line : total;

    start = Math.max(1, start);
    end = Math.min(total, end);

    if (start > end) {
      return `Error: start_line (${start}) > end_line (${end}). File has ${total} lines.`;
    }

    const selected = lines.slice(start - 1, end);
    const width = String(end).length;
    const numbered = selected.map(
      (line, i) => `${String(start + i).padStart(width)} | ${line}`,
    );
    const header = `File: ${rawPath} (lines ${start}-${end} of ${total})\n`;
    return header + numbered.join("\n");
  }
}
