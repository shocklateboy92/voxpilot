import type { ChatCompletionTool } from "openai/resources";
import { z } from "zod/v4";
import { parseJsonArgs, type Tool, type ToolResult } from "./base";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  all(): Tool[] {
    return Array.from(this.tools.values());
  }

  toOpenAiTools(): ChatCompletionTool[] {
    return this.all().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: z.toJSONSchema(t.parameters) as Record<string, unknown>,
      },
    }));
  }

  async execute(
    name: string,
    rawArgs: string,
    workDir: string,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: '${name}'`);
    }
    const parsed = parseJsonArgs(tool.parameters, rawArgs);
    return tool.execute(parsed, workDir);
  }
}
