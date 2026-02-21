import type { ChatCompletionTool, FunctionDefinition } from "openai/resources";
import type { Tool, ToolResult } from "./base";

export class CopilotAgentTool implements Tool {
  readonly requiresConfirmation = false;

  readonly definition: FunctionDefinition = {
    name: "copilot_agent",
    description:
      "Delegate a coding task to GitHub Copilot. Copilot will autonomously modify files in the workspace. Use the same session_name for follow-up instructions to the same task. Use a different session_name for independent tasks.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The instruction to send to Copilot.",
        },
        session_name: {
          type: "string",
          description:
            'A short descriptive name for the ACP session context (e.g. "auth-bug-fix", "refactor-logger"). First use creates a new ACP session; subsequent uses route to the existing session for follow-ups.',
        },
      },
      required: ["prompt", "session_name"],
      additionalProperties: false,
    },
  };

  toOpenAiTool(): ChatCompletionTool {
    return { type: "function", function: this.definition };
  }

  async execute(
    _args: Record<string, unknown>,
    _workDir: string,
  ): Promise<ToolResult> {
    // copilot_agent is special-cased by the agent loop, which calls
    // the CopilotConnection service directly with streaming support.
    // This execute() method should never be invoked at runtime.
    throw new Error(
      "copilot_agent must be handled by the agent loop — do not call execute() directly",
    );
  }
}
