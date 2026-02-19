import type { ChatCompletionTool } from "openai/resources";
import type { Tool } from "./base";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  all(): Tool[] {
    return Array.from(this.tools.values());
  }

  toOpenAiTools(): ChatCompletionTool[] {
    return this.all().map((t) => t.toOpenAiTool());
  }
}
