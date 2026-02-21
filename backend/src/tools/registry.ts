import type { ChatCompletionTool } from "openai/resources";
import { z } from "zod/v4";
import type { Tool, ToolResult } from "./base";

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
        // All registered tools use Zod schemas for parameters; cast for JSON Schema conversion
        parameters: z.toJSONSchema(
          t.parameters as unknown as Parameters<typeof z.toJSONSchema>[0],
        ) as Record<string, unknown>,
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
    const raw: unknown = rawArgs ? JSON.parse(rawArgs) : {};
    const parsed = tool.parameters.parse(raw);
    return tool.execute(parsed, workDir);
  }
}
