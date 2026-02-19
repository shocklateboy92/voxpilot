import { z } from "zod/v4";
import { ToolCallInfo } from "./api";

const messageRole = z.enum(["user", "assistant", "system", "tool"]);

export const MessageEvent = z.object({
  role: messageRole,
  content: z.string(),
  created_at: z.string(),
  tool_calls: z.array(ToolCallInfo).nullable().optional(),
  tool_call_id: z.string().nullable().optional(),
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
