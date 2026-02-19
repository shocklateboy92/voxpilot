import type { ChatCompletionTool, FunctionDefinition } from "openai/resources";
import { realpath } from "node:fs/promises";
import { resolve, relative } from "node:path";

/**
 * Result returned by a tool's `execute()` method.
 *
 * - `llmResult` — compact summary fed back to the LLM context (and persisted in DB).
 * - `displayResult` — full output streamed to the user via SSE (can be much larger).
 *
 * For tools where both are identical, use the `simpleResult()` helper.
 */
export interface ToolResult {
  llmResult: string;
  displayResult: string;
}

/** Create a `ToolResult` where both fields are the same string. */
export function simpleResult(text: string): ToolResult {
  return { llmResult: text, displayResult: text };
}

export interface Tool {
  definition: FunctionDefinition;
  requiresConfirmation: boolean;
  execute(args: Record<string, unknown>, workDir: string): Promise<ToolResult>;
  toOpenAiTool(): ChatCompletionTool;
}

/**
 * Resolve `raw` relative to `workDir` and ensure it stays inside.
 * Follows symlinks so that a link pointing outside is correctly rejected.
 * Returns `null` if the resolved path escapes `workDir`.
 */
export async function resolvePath(
  raw: string,
  workDir: string,
): Promise<string | null> {
  const absWorkDir = resolve(workDir);
  const resolved = resolve(absWorkDir, raw);
  const rel = relative(absWorkDir, resolved);
  if (rel.startsWith("..") || resolve(absWorkDir, rel) !== resolved) {
    return null;
  }

  // Follow symlinks to detect escapes
  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    // File might not exist yet — fall back to string-based check only
    return resolved;
  }

  const realRel = relative(absWorkDir, real);
  if (realRel.startsWith("..")) {
    return null;
  }

  return resolved;
}
