/**
 * API client and global SSE event stream.
 *
 * Uses the `/global/event` SSE endpoint so VoxPilot receives events from
 * ALL instances (including worktree sessions that run in a different
 * directory/instance). Consumers register listeners via addEventListener /
 * removeEventListener.
 */

import type {
  Agent,
  Event,
  EventWorktreeFailed,
  EventWorktreeReady,
  File as SdkFile,
  GlobalEvent,
  Message,
  Part,
  PermissionRequest,
  Project,
  QuestionAnswer,
  QuestionRequest,
  Session,
  Worktree,
} from "@opencode-ai/sdk/v2/client";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

export type { Event, Agent, Project, Session, Message, Part, PermissionRequest, QuestionRequest, QuestionAnswer, Worktree, SdkFile };

export type MessageWithParts = {
  info: Message;
  parts: Part[];
};

export const client = createOpencodeClient({
  baseUrl: `${window.location.origin}/oc`,
});

// ── Global SSE event stream ─────────────────────────────────────

export type EventListener = (event: Event) => void;

const sseAbort = new AbortController();
const listeners = new Set<EventListener>();

// Clean up on HMR: abort the SSE connection and clear listeners
// before the new module instance re-executes and starts a fresh one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    sseAbort.abort();
    listeners.clear();
  });
}

export function addEventListener(listener: EventListener): void {
  listeners.add(listener);
}

export function removeEventListener(listener: EventListener): void {
  listeners.delete(listener);
}

/** Start the global SSE stream. Runs for the lifetime of the app (or until HMR). */
void (async () => {
  const signal = sseAbort.signal;
  try {
    const result = await client.global.event();
    for await (const raw of result.stream) {
      if (signal.aborted) break;
      const globalEvent = raw as GlobalEvent;
      const payload = globalEvent.payload;
      for (const listener of listeners) {
        listener(payload);
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") return;
    if (signal.aborted) return;
    console.error("Global event stream error:", err);
  }
})();

// ── Session API ─────────────────────────────────────────────────

export async function createSession(title?: string, directory?: string): Promise<Session> {
  const result = await client.session.create({ title, directory });
  if (!result.data)
    throw new Error(
      "Failed to create session: " + JSON.stringify(result.error),
    );
  return result.data;
}

export async function deleteSession(sessionID: string, directory?: string): Promise<void> {
  await client.session.delete({ sessionID, directory });
}

export async function fetchMessages(
  sessionID: string,
  directory?: string,
): Promise<MessageWithParts[]> {
  const result = await client.session.messages({ sessionID, directory });
  return (result.data ?? []) as MessageWithParts[];
}

export async function sendPromptAsync(
  sessionID: string,
  text: string,
  agent?: string,
  directory?: string,
): Promise<void> {
  await client.session.promptAsync({
    sessionID,
    parts: [{ type: "text", text }],
    agent,
    directory,
  });
}

export async function abortSession(sessionID: string, directory?: string): Promise<void> {
  await client.session.abort({ sessionID, directory });
}

export async function forkSession(
  sessionID: string,
  messageID?: string,
  directory?: string,
): Promise<Session> {
  const result = await client.session.fork({ sessionID, messageID, directory });
  if (!result.data)
    throw new Error(
      "Failed to fork session: " + JSON.stringify(result.error),
    );
  return result.data;
}

export async function respondToPermission(
  requestID: string,
  reply: "once" | "always" | "reject",
  directory?: string,
): Promise<void> {
  await client.permission.reply({ requestID, reply, directory });
}

export async function replyToQuestion(
  requestID: string,
  answers: QuestionAnswer[],
  directory?: string,
): Promise<void> {
  await client.question.reply({ requestID, answers, directory });
}

export async function rejectQuestion(requestID: string, directory?: string): Promise<void> {
  await client.question.reject({ requestID, directory });
}

export async function fetchPendingPermissions(directory?: string): Promise<PermissionRequest[]> {
  const result = await client.permission.list({ directory });
  return (result.data ?? []) as PermissionRequest[];
}

export async function fetchPendingQuestions(directory?: string): Promise<QuestionRequest[]> {
  const result = await client.question.list({ directory });
  return (result.data ?? []) as QuestionRequest[];
}

export async function fetchGitBranch(directory?: string): Promise<string | null> {
  try {
    const result = await client.vcs.get({ directory });
    return result.data?.branch ?? null;
  } catch {
    return null;
  }
}

export async function fetchFileStatus(directory?: string): Promise<SdkFile[]> {
  try {
    const result = await client.file.status({ directory });
    return result.data ?? [];
  } catch {
    return [];
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

export async function fetchProjects(): Promise<Project[]> {
  try {
    const result = await client.project.list();
    return result.data ?? [];
  } catch {
    return [];
  }
}

export async function fetchCurrentProject(): Promise<Project | undefined> {
  try {
    const result = await client.project.current();
    return result.data ?? undefined;
  } catch {
    return undefined;
  }
}

// ── Worktree API ────────────────────────────────────────────────

/** Default timeout for waiting for worktree.ready (30 seconds). */
const WORKTREE_READY_TIMEOUT_MS = 30_000;

export async function fetchWorktrees(directory: string): Promise<string[]> {
  const result = await client.worktree.list({ directory });
  return result.data ?? [];
}

export async function createWorktree(directory: string, name?: string): Promise<Worktree> {
  const result = await client.worktree.create({
    directory,
    worktreeCreateInput: name ? { name } : undefined,
  });
  if (!result.data)
    throw new Error(
      "Failed to create worktree: " + JSON.stringify(result.error),
    );

  // The server populates the worktree asynchronously after returning.
  // Listen for the worktree.ready/failed event on the main global stream.
  const worktreeName = result.data.name;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      removeEventListener(listener);
      reject(new Error(`Timed out waiting for worktree "${worktreeName}" to be ready`));
    }, WORKTREE_READY_TIMEOUT_MS);

    function listener(event: Event): void {
      if (event.type === "worktree.ready") {
        const props = (event as EventWorktreeReady).properties;
        if (props.name !== worktreeName) return;
        removeEventListener(listener);
        clearTimeout(timeoutId);
        resolve();
      }
      if (event.type === "worktree.failed") {
        const props = (event as EventWorktreeFailed).properties;
        removeEventListener(listener);
        clearTimeout(timeoutId);
        reject(new Error(`Worktree creation failed: ${props.message}`));
      }
    }

    addEventListener(listener);
  });

  return result.data;
}
