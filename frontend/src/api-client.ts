/**
 * API client using OpenCode SDK.
 */
import { createOpencodeClient } from "@opencode-ai/sdk/client"
import type { Session, Message, Part, FileDiff } from "@opencode-ai/sdk/client"

export type { Session, Message, Part, FileDiff }

export type MessageWithParts = {
  info: Message
  parts: Part[]
}

const client = createOpencodeClient({
  baseUrl: `${window.location.origin}/oc`,
})

export { client }

export async function fetchSessions(): Promise<Session[]> {
  const result = await client.session.list()
  return result.data ?? []
}

export async function createSession(title?: string): Promise<Session> {
  const body: { title?: string } = {}
  if (title !== undefined) {
    body.title = title
  }
  const result = await client.session.create({ body })
  if (!result.data) throw new Error("Failed to create session")
  return result.data
}

export async function deleteSession(id: string): Promise<void> {
  await client.session.delete({ path: { id } })
}

export async function fetchMessages(sessionId: string): Promise<MessageWithParts[]> {
  const result = await client.session.messages({ path: { id: sessionId } })
  return (result.data ?? []) as MessageWithParts[]
}

export async function sendPromptAsync(
  sessionId: string,
  text: string,
): Promise<void> {
  await client.session.promptAsync({
    path: { id: sessionId },
    body: { parts: [{ type: "text", text }] },
  })
}

export async function abortSession(sessionId: string): Promise<void> {
  await client.session.abort({ path: { id: sessionId } })
}

export async function respondToPermission(
  sessionId: string,
  permissionId: string,
  response: "once" | "always" | "reject",
): Promise<void> {
  await client.postSessionIdPermissionsPermissionId({
    path: { id: sessionId, permissionID: permissionId },
    body: { response },
  })
}

export async function fetchSessionDiff(sessionId: string): Promise<FileDiff[]> {
  const result = await client.session.diff({ path: { id: sessionId } })
  return (result.data ?? []) as FileDiff[]
}
