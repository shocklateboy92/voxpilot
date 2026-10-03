/** Native OpenCode API and explicitly started, live-only event stream. */

import type {
  AgentInfo as Agent,
  SessionMessageAssistant as AssistantMessage,
  OpenCodeEvent as Event,
  FormAnswer,
  SessionMessageInfo as Message,
  ModelRef,
  PermissionReply,
  PermissionRequest,
  Project,
  FormDetail as QuestionRequest,
  VcsFileStatus as SdkFile,
  SessionInfo as Session,
  WorktreeInfo,
} from "@opencode/client";
import { OpenCode } from "@opencode/client";

export type {
  Agent,
  AssistantMessage,
  Event,
  FormAnswer,
  Message,
  ModelRef,
  PermissionRequest,
  Project,
  QuestionRequest,
  SdkFile,
  Session,
};
export type {
  SessionMessageAssistantTool as ToolPart,
  SessionStatus,
} from "@opencode/client";
export type Part = AssistantMessage["content"][number];

export const client = OpenCode.make({
  baseUrl: `${window.location.origin}/oc`,
});

export type EventListener = (event: Event) => void;

const sseAbort = new AbortController();
const listeners = new Set<EventListener>();
let streamStarted = false;

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

/** Call after bootstrap and listener registration, never during module import. */
export function startEventStream(): void {
  if (streamStarted || sseAbort.signal.aborted) return;
  streamStarted = true;
  void (async () => {
    const signal = sseAbort.signal;
    let delay = 1_000;
    while (!signal.aborted) {
      try {
        for await (const event of client.event.subscribe({ signal })) {
          if (signal.aborted) return;
          delay = 1_000;
          // Forward server.connected on every connection so consumers can
          // reconcile snapshots, including events missed since bootstrap.
          for (const listener of listeners) {
            try {
              listener(event);
            } catch (error) {
              console.error("OpenCode event listener failed:", error);
            }
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        console.error("OpenCode event stream failed:", error);
      }
      if (signal.aborted) return;
      // EOF also reconnects. HMR cancels both the transport and this delay.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(finish, delay);
        function finish() {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        }
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
      delay = Math.min(delay * 2, 30_000);
    }
  })();
}

export async function createSession(
  title?: string,
  directory?: string,
  agent?: string,
  model?: ModelRef,
): Promise<Session> {
  return client.session.create({
    title,
    location: directory === undefined ? undefined : { directory },
    agent,
    model,
  });
}

export async function deleteSession(sessionID: string): Promise<void> {
  await client.session.remove({ sessionID });
}

export async function fetchMessages(sessionID: string): Promise<Message[]> {
  const messages: Message[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.message.list({
      sessionID,
      limit: 100,
      // Cursors encode ordering; the API rejects cursor combined with order.
      ...(cursor === undefined ? { order: "asc" } : { cursor }),
    });
    messages.push(...page.data);
    cursor = page.cursor.next ?? undefined;
  } while (cursor !== undefined);
  return messages;
}

export async function sendPromptAsync(
  sessionID: string,
  text: string,
  agent?: string,
  model?: ModelRef,
): Promise<void> {
  if (agent !== undefined) {
    await client.session.switchAgent({ sessionID, agent });
  }
  if (model !== undefined) {
    await client.session.switchModel({ sessionID, model });
  }
  await client.session.prompt({ sessionID, text });
}

export async function abortSession(sessionID: string): Promise<void> {
  await client.session.interrupt({ sessionID });
}

export async function forkSession(
  sessionID: string,
  messageID?: string,
): Promise<Session> {
  return client.session.fork({ sessionID, before: messageID });
}

export async function respondToPermission(
  sessionID: string,
  requestID: string,
  decision: PermissionReply,
): Promise<void> {
  await client.permission.reply({ sessionID, requestID, decision });
}

export async function replyToQuestion(
  sessionID: string,
  formID: string,
  answer: FormAnswer,
): Promise<void> {
  await client.session.form.reply({ sessionID, formID, answer });
}

export async function rejectQuestion(
  sessionID: string,
  formID: string,
): Promise<void> {
  await client.session.form.cancel({ sessionID, formID });
}

export async function fetchPendingPermissions(
  sessionID: string,
): Promise<PermissionRequest[]> {
  return client.permission.list({ sessionID });
}

export async function fetchPendingQuestions(
  sessionID: string,
): Promise<QuestionRequest[]> {
  const result = await client.session.form.list({ sessionID });
  const forms = await Promise.all(
    result.map((form) =>
      client.session.form.get({ sessionID, formID: form.id }),
    ),
  );
  return forms.filter((form) => form.state.status === "pending");
}

export async function fetchGitBranch(
  directory?: string,
): Promise<string | null> {
  const result = await client.vcs.get({ location: { directory } });
  return result.data.branch.current ?? null;
}

export async function fetchFileStatus(directory?: string): Promise<SdkFile[]> {
  const result = await client.vcs.status({ location: { directory } });
  return result.data;
}

export async function fetchAgents(): Promise<Agent[]> {
  return (await client.agent.list()).data;
}

export async function fetchProjects(): Promise<Project[]> {
  return client.project.list();
}

export async function fetchCurrentProject(): Promise<Project | undefined> {
  const location = await client.location.get();
  const projects = await fetchProjects();
  return projects.find((project) => project.id === location.project.id);
}

export async function fetchProviders() {
  return (await client.provider.list()).data;
}

export async function fetchModels() {
  return (await client.model.list()).data;
}

export async function fetchDefaultModel() {
  return (await client.model.default()).data;
}

export async function fetchWorktrees(directory: string): Promise<string[]> {
  const location = await client.location.get({ location: { directory } });
  const worktrees = await client.worktree.list({
    projectID: location.project.id,
  });
  return worktrees.map((worktree) => worktree.directory);
}

export async function createWorktree(
  directory: string,
  name?: string,
): Promise<WorktreeInfo> {
  const location = await client.location.get({ location: { directory } });
  // The native operation completes creation and project setup before returning.
  return client.worktree.create({ projectID: location.project.id, name });
}
