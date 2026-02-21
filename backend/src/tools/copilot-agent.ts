import { z } from "zod/v4";
import type { Tool, ToolResult } from "./base";

export const copilotAgentParameters = z
  .object({
    prompt: z.string().describe("The instruction to send to Copilot."),
    session_name: z
      .string()
      .describe(
        'A short descriptive name for the ACP session context (e.g. "auth-bug-fix", "refactor-logger"). First use creates a new ACP session; subsequent uses route to the existing session for follow-ups.',
      ),
  })
  .strict();

type Params = z.infer<typeof copilotAgentParameters>;

export class CopilotAgentTool implements Tool<typeof copilotAgentParameters> {
  readonly name = "copilot_agent";
  readonly description =
    "Delegate a coding task to GitHub Copilot. Copilot will autonomously modify files in the workspace. Use the same session_name for follow-up instructions to the same task. Use a different session_name for independent tasks.";
  readonly parameters = copilotAgentParameters;
  readonly requiresConfirmation = false;

  async execute(_args: Params, _workDir: string): Promise<ToolResult> {
    // copilot_agent is special-cased by the agent loop, which calls
    // the CopilotConnection service directly with streaming support.
    // This execute() method should never be invoked at runtime.
    throw new Error(
      "copilot_agent must be handled by the agent loop — do not call execute() directly",
    );
  }
}
