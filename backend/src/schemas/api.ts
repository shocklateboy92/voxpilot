import { z } from "zod/v4";

export const StatusResponse = z.object({
  status: z.string(),
});
export type StatusResponse = z.infer<typeof StatusResponse>;

export const HealthResponse = z.object({
  status: z.string(),
  app_name: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const GitHubUser = z.object({
  login: z.string(),
  name: z.string().nullable().optional(),
  avatar_url: z.string(),
});
export type GitHubUser = z.infer<typeof GitHubUser>;

export const ToolCallInfo = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.string(),
});
export type ToolCallInfo = z.infer<typeof ToolCallInfo>;

const messageRole = z.enum(["user", "assistant", "system", "tool"]);

export const ChatMessage = z.object({
  role: messageRole,
  content: z.string(),
  tool_calls: z.array(ToolCallInfo).nullable().optional(),
  tool_call_id: z.string().nullable().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const SendMessageRequest = z.object({
  content: z.string(),
  model: z.string().default("gpt-4o"),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const MessageRead = z.object({
  role: messageRole,
  content: z.string(),
  created_at: z.string(),
  tool_calls: z.array(ToolCallInfo).nullable().optional(),
  tool_call_id: z.string().nullable().optional(),
});
export type MessageRead = z.infer<typeof MessageRead>;

export const SessionSummary = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const SessionDetail = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(MessageRead),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

export const SessionUpdate = z.object({
  title: z.string(),
});
export type SessionUpdate = z.infer<typeof SessionUpdate>;

export const ToolConfirmRequest = z.object({
  tool_call_id: z.string(),
  approved: z.boolean(),
});
export type ToolConfirmRequest = z.infer<typeof ToolConfirmRequest>;

// ── Artifact API types ───────────────────────────────────────────────────────

export const ViewedRequest = z.object({
  viewed: z.boolean(),
});
export type ViewedRequest = z.infer<typeof ViewedRequest>;

export const AddCommentRequest = z.object({
  content: z.string(),
  line_id: z.string().nullable().optional(),
  line_number: z.number().nullable().optional(),
});
export type AddCommentRequest = z.infer<typeof AddCommentRequest>;
