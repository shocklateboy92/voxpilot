/**
 * Session and message persistence backed by Drizzle ORM.
 */

import { asc, desc, eq } from "drizzle-orm";
import type { getDb } from "../db";
import { messages, sessions } from "../schema";
import type { ToolCallInfo } from "../schema";
import type { ChatMessage, MessageRead, SessionDetail, SessionSummary } from "../schemas/api";
import type { MessageEvent } from "../schemas/events";
import { renderMarkdown } from "./markdown";

type Db = ReturnType<typeof getDb>;

function nowIso(): string {
  return new Date().toISOString();
}

function parseToolCalls(raw: unknown): ToolCallInfo[] | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ToolCallInfo[];
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) return raw as ToolCallInfo[];
  return null;
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

export async function listSessions(db: Db): Promise<SessionSummary[]> {
  const rows = await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
}

export async function createSession(db: Db): Promise<SessionSummary> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.insert(sessions).values({ id, title: "", createdAt: now, updatedAt: now });
  return { id, title: "", created_at: now, updated_at: now };
}

export async function getSession(
  db: Db,
  sessionId: string,
): Promise<SessionDetail | null> {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  const row = rows[0];
  if (!row) return null;

  const msgRows = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.id));

  const msgs: MessageRead[] = msgRows.map((m) => ({
    role: m.role as MessageRead["role"],
    content: m.content,
    created_at: m.createdAt,
    tool_calls: parseToolCalls(m.toolCalls) ?? undefined,
    tool_call_id: m.toolCallId ?? undefined,
  }));

  return {
    id: row.id,
    title: row.title,
    messages: msgs,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function deleteSession(
  db: Db,
  sessionId: string,
): Promise<boolean> {
  const result = await db
    .delete(sessions)
    .where(eq(sessions.id, sessionId))
    .returning({ id: sessions.id });
  return result.length > 0;
}

export async function updateSessionTitle(
  db: Db,
  sessionId: string,
  title: string,
): Promise<SessionSummary | null> {
  const now = nowIso();
  const updated = await db
    .update(sessions)
    .set({ title, updatedAt: now })
    .where(eq(sessions.id, sessionId))
    .returning();
  const row = updated[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// ── Message helpers ───────────────────────────────────────────────────────────

export async function addMessage(
  db: Db,
  sessionId: string,
  role: string,
  content: string,
  opts?: { toolCalls?: string | null; toolCallId?: string | null; artifactId?: string | null },
): Promise<void> {
  const now = nowIso();
  const toolCalls = opts?.toolCalls
    ? (JSON.parse(opts.toolCalls) as ToolCallInfo[])
    : null;
  await db.insert(messages).values({
    sessionId,
    role,
    content,
    toolCalls,
    toolCallId: opts?.toolCallId ?? null,
    artifactId: opts?.artifactId ?? null,
    createdAt: now,
  });
  await db
    .update(sessions)
    .set({ updatedAt: now })
    .where(eq(sessions.id, sessionId));
}

export async function getMessages(
  db: Db,
  sessionId: string,
): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.id));
  return rows.map((r) => ({
    role: r.role as ChatMessage["role"],
    content: r.content,
    tool_calls: parseToolCalls(r.toolCalls) ?? undefined,
    tool_call_id: r.toolCallId ?? undefined,
  }));
}

export async function getMessagesWithTimestamps(
  db: Db,
  sessionId: string,
): Promise<MessageEvent[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.id));
  return rows.map((r) => {
    const role = r.role as MessageEvent["role"];
    const html =
      role === "assistant" && r.content ? renderMarkdown(r.content) : null;
    return {
      role,
      content: r.content,
      created_at: r.createdAt,
      tool_calls: parseToolCalls(r.toolCalls) ?? undefined,
      tool_call_id: r.toolCallId ?? undefined,
      artifact_id: r.artifactId ?? undefined,
      html,
    };
  });
}

export async function sessionExists(
  db: Db,
  sessionId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return rows.length > 0;
}

export async function autoTitleIfNeeded(
  db: Db,
  sessionId: string,
  content: string,
): Promise<void> {
  const rows = await db
    .select({ title: sessions.title })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  const row = rows[0];
  if (!row || row.title !== "") return;

  let title = content.slice(0, 50);
  if (content.length > 50) {
    title += "\u2026";
  }
  await db
    .update(sessions)
    .set({ title })
    .where(eq(sessions.id, sessionId));
}
