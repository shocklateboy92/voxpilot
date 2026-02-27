/**
 * API client using OpenCode SDK.
 */

import type {
  Agent,
  Message,
  Part,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  Session,
  SessionStatus,
} from "@opencode-ai/sdk/v2/client";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

export type {
  Agent,
  Session,
  Message,
  Part,
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
  const result = await client.session.create({ title });
  if (!result.data)
    throw new Error(
      "Failed to create session: " + JSON.stringify(result.error),
    );
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
  agent?: string,
): Promise<void> {
  await client.session.promptAsync({
    sessionID,
    parts: [{ type: "text", text }],
    agent,
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

export async function fetchPendingPermissions(): Promise<PermissionRequest[]> {
  const result = await client.permission.list();
  return (result.data ?? []) as PermissionRequest[];
}

export async function fetchPendingQuestions(): Promise<QuestionRequest[]> {
  const result = await client.question.list();
  return (result.data ?? []) as QuestionRequest[];
}

export async function fetchSessionStatus(
  sessionID: string,
): Promise<SessionStatus | undefined> {
  const result = await client.session.status();
  const statuses = result.data as Record<string, SessionStatus> | undefined;
  return statuses?.[sessionID];
}

export async function fetchGitBranch(): Promise<string | null> {
  try {
    const result = await client.vcs.get();
    return result.data?.branch ?? null;
  } catch {
    return null;
  }
}

export async function fetchAgents(): Promise<Agent[]> {
  try {
    const result = await client.app.agents();
    return result.data ?? [];
  } catch {
    return [];
  }
}
