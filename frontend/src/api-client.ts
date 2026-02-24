/**
 * API client using OpenCode SDK.
 */

import type {
  FileDiff,
  Message,
  Part,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  Session,
} from "@opencode-ai/sdk/v2/client";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

export type {
  Session,
  Message,
  Part,
  FileDiff,
  PermissionRequest,
  QuestionRequest,
  QuestionAnswer,
};

export type MessageWithParts = {
  info: Message;
  parts: Part[];
};

const client = createOpencodeClient({
  baseUrl: `${window.location.origin}/oc`,
});

export { client };

export async function fetchSessions(): Promise<Session[]> {
  const result = await client.session.list();
  return result.data ?? [];
}

export async function createSession(title?: string): Promise<Session> {
  const result = await client.session.create(
    title !== undefined ? { title } : undefined,
  );
  if (!result.data) throw new Error("Failed to create session");
  return result.data;
}

export async function deleteSession(sessionID: string): Promise<void> {
  await client.session.delete({ sessionID });
}

export async function fetchMessages(
  sessionID: string,
): Promise<MessageWithParts[]> {
  const result = await client.session.messages({ sessionID });
  return (result.data ?? []) as MessageWithParts[];
}

export async function sendPromptAsync(
  sessionID: string,
  text: string,
): Promise<void> {
  await client.session.promptAsync({
    sessionID,
    parts: [{ type: "text", text }],
  });
}

export async function abortSession(sessionID: string): Promise<void> {
  await client.session.abort({ sessionID });
}

export async function respondToPermission(
  requestID: string,
  reply: "once" | "always" | "reject",
): Promise<void> {
  await client.permission.reply({ requestID, reply });
}

export async function replyToQuestion(
  requestID: string,
  answers: QuestionAnswer[],
): Promise<void> {
  await client.question.reply({ requestID, answers });
}

export async function rejectQuestion(requestID: string): Promise<void> {
  await client.question.reject({ requestID });
}

export async function fetchSessionDiff(sessionID: string): Promise<FileDiff[]> {
  const result = await client.session.diff({ sessionID });
  return (result.data ?? []) as FileDiff[];
}
