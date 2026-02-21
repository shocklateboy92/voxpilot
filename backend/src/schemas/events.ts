import { z } from "zod/v4";
import { ToolCallInfo } from "./api";

const messageRole = z.enum(["user", "assistant", "system", "tool"]);

export const MessageEvent = z.object({
  role: messageRole,
  content: z.string(),
  created_at: z.string(),
  tool_calls: z.array(ToolCallInfo).nullable().optional(),
  tool_call_id: z.string().nullable().optional(),
  artifact_id: z.string().nullable().optional(),
  html: z.string().nullable().optional(),
});
export type MessageEvent = z.infer<typeof MessageEvent>;

export const ToolCallEvent = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.string(),
});
export type ToolCallEvent = z.infer<typeof ToolCallEvent>;

export const ToolResultEvent = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  is_error: z.boolean().default(false),
  artifact_id: z.string().nullable().optional(),
});
export type ToolResultEvent = z.infer<typeof ToolResultEvent>;

export const TextDeltaEvent = z.object({
  content: z.string(),
});
export type TextDeltaEvent = z.infer<typeof TextDeltaEvent>;

export const DoneEvent = z.object({
  model: z.string(),
  html: z.string().nullable().optional(),
});
export type DoneEvent = z.infer<typeof DoneEvent>;

export const ErrorEvent = z.object({
  message: z.string(),
});
export type ErrorEvent = z.infer<typeof ErrorEvent>;

export const ToolConfirmEvent = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.string(),
});
export type ToolConfirmEvent = z.infer<typeof ToolConfirmEvent>;

// ── Review artifact SSE event ────────────────────────────────────────────────

export const ReviewArtifactFileEvent = z.object({
  id: z.string(),
  path: z.string(),
  changeType: z.string(),
  additions: z.number(),
  deletions: z.number(),
  viewed: z.boolean().optional(),
});
export type ReviewArtifactFileEvent = z.infer<typeof ReviewArtifactFileEvent>;

export const ReviewArtifactEvent = z.object({
  artifactId: z.string(),
  title: z.string(),
  status: z.string(),
  totalFiles: z.number(),
  totalAdditions: z.number(),
  totalDeletions: z.number(),
  files: z.array(ReviewArtifactFileEvent),
});
export type ReviewArtifactEvent = z.infer<typeof ReviewArtifactEvent>;

// ── Copilot ACP SSE events ──────────────────────────────────────────────────

export const CopilotDeltaEvent = z.object({
  tool_call_id: z.string(),
  content: z.string(),
  session_name: z.string(),
});
export type CopilotDeltaEvent = z.infer<typeof CopilotDeltaEvent>;

export const CopilotDoneEvent = z.object({
  tool_call_id: z.string(),
  summary: z.string(),
  stop_reason: z.string(),
  session_name: z.string(),
});
export type CopilotDoneEvent = z.infer<typeof CopilotDoneEvent>;
