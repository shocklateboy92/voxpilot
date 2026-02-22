import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { z } from "zod/v4";

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

/**
 * JSON-parse `json` (treating empty/missing as `{}`) then validate through a Zod schema.
 * Throws a `ZodError` if validation fails.
 */
export function parseJsonArgs<T extends z.ZodType>(
  schema: T,
  json: string,
): z.infer<T> {
  const raw: unknown = json ? JSON.parse(json) : {};
  return schema.parse(raw) as z.infer<T>;
}

/**
 * JSON-parse `json` (treating empty/missing as `{}`) then safely validate through a Zod schema.
 * Never throws; returns `{ success: true, data }` or `{ success: false, error }`.
 */
export function safeParseJsonArgs<T extends z.ZodType>(
  schema: T,
  json: string,
): ReturnType<T["safeParse"]> {
  const raw: unknown = json ? JSON.parse(json) : {};
  return schema.safeParse(raw) as ReturnType<T["safeParse"]>;
}

export interface Tool<T extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly parameters: T;
  readonly requiresConfirmation: boolean;
  execute(args: z.infer<T>, workDir: string): Promise<ToolResult>;
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
