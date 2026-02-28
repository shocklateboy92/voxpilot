/**
 * API client using OpenCode SDK.
 */

import type {
  Agent,
  EventWorktreeFailed,
  EventWorktreeReady,
  GlobalEvent,
  Message,
  Part,
  PermissionRequest,
  Project,
  QuestionAnswer,
  QuestionRequest,
  Session,
  SessionStatus,
  Worktree,
} from "@opencode-ai/sdk/v2/client";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

export type {
  Agent,
  Project,
  Session,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  QuestionAnswer,
  Worktree,
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

export async function fetchSessionStatus(
  sessionID: string,
  directory?: string,
): Promise<SessionStatus | undefined> {
  const result = await client.session.status({ directory });
  const statuses = result.data as Record<string, SessionStatus> | undefined;
  return statuses?.[sessionID];
}

export async function fetchGitBranch(directory?: string): Promise<string | null> {
  try {
    const result = await client.vcs.get({ directory });
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

export async function createWorktree(directory: string): Promise<Worktree> {
  const result = await client.worktree.create({ directory });
  if (!result.data)
    throw new Error(
      "Failed to create worktree: " + JSON.stringify(result.error),
    );

  // The server populates the worktree asynchronously after returning.
  // Wait for the worktree.ready SSE event before using it.
  await waitForWorktreeReady(result.data.name);

  return result.data;
}

/** Default timeout for waiting for worktree.ready (30 seconds). */
const WORKTREE_READY_TIMEOUT_MS = 30_000;

/**
 * Wait for a `worktree.ready` SSE event matching the given worktree name.
 * Rejects if `worktree.failed` arrives or the timeout expires.
 *
 * Uses the `/global/event` SSE stream because `worktree.ready` is emitted
 * via GlobalBus (not the per-instance Bus), so it only appears on the
 * global event endpoint — not on the per-instance `/event` stream that
 * VoxPilot normally subscribes to.
 */
function waitForWorktreeReady(worktreeName: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const abort = new AbortController();

    function settle(fn: () => void): void {
      if (settled) return;
      settled = true;
      abort.abort();
      clearTimeout(timeoutId);
      fn();
    }

    // Open a short-lived SSE connection to /global/event
    void client.global
      .event({ signal: abort.signal })
      .then(async (result) => {
        for await (const raw of result.stream) {
          if (abort.signal.aborted) break;
          const globalEvent = raw as GlobalEvent;
          const event = globalEvent.payload;

          if (event.type === "worktree.ready") {
            const props = (event as EventWorktreeReady).properties;
            if (props.name === worktreeName) {
              settle(() => resolve());
              break;
            }
          }

          if (event.type === "worktree.failed") {
            const props = (event as EventWorktreeFailed).properties;
            settle(() =>
              reject(new Error(`Worktree creation failed: ${props.message}`)),
            );
            break;
          }
        }
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        settle(() =>
          reject(
            err instanceof Error
              ? err
              : new Error("Global event stream failed"),
          ),
        );
      });

    const timeoutId = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `Timed out waiting for worktree "${worktreeName}" to be ready`,
          ),
        ),
      );
    }, WORKTREE_READY_TIMEOUT_MS);
  });
}
