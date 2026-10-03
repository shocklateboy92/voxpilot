/** Native V2 events, with frame-batched content and guarded snapshot recovery. */
import { batch, createEffect, createRoot, on } from "solid-js";
import { produce, reconcile } from "solid-js/store";
import { effectiveAgent } from "./agent-selection";
import type {
  AssistantMessage,
  Event,
  Message,
  Part,
  SessionStatus,
} from "./api-client";
import {
  abortSession,
  addEventListener,
  client,
  fetchFileStatus,
  fetchGitBranch,
  fetchMessages,
  fetchPendingPermissions,
  removeEventListener,
  sendPromptAsync,
  startEventStream,
} from "./api-client";
import { init } from "./init";
import { activeSession, activeSessionId } from "./navigation";
import { selectedModel } from "./preferences";
import { replaceMessages, setStore, store } from "./store";

type ContentEvent = Extract<
  Event,
  {
    type:
      | "session.text.started"
      | "session.text.delta"
      | "session.text.ended"
      | "session.reasoning.started"
      | "session.reasoning.delta"
      | "session.reasoning.ended"
      | "session.tool.input.started"
      | "session.tool.input.delta"
      | "session.tool.input.ended"
      | "session.tool.progress";
  }
>;

let disposed = false;
let generation = 0;
let historyRequest = 0;
let reconnectRequest = 0;
let filesRequest = 0;
let raf: number | undefined;
let filesTimer: ReturnType<typeof setTimeout> | undefined;
const revisions = new Map<string, number>();
const statusRevisions = new Map<string, number>();
const messageRevisions = new Map<string, number>();
let snapshotRequest = 0;
const appliedSnapshots = new Map<string, number>();
const metadataRequests = new Map<string, number>();
const pendingRequests = new Map<string, number>();
const deletedSessions = new Set<string>();
const messageRequests = new Map<string, Promise<void>>();
const dirtyMessages = new Set<string>();
const pendingContent = new Map<string, ContentEvent[]>();
const touchedMessages = new Set<string>();
// Each text/reasoning ordinal owns its revision independently of other fragments.
const textRevisions = new Map<string, number>();

function bump(map: Map<string, number>, key: string): number {
  const value = (map.get(key) ?? 0) + 1;
  map.set(key, value);
  return value;
}

function isCurrent(sessionID: string, version: number): boolean {
  return !disposed && generation === version && activeSessionId() === sessionID;
}

function upsertMessage(message: Message): void {
  setStore(
    "messages",
    produce((messages: Message[]) => {
      const index = messages.findIndex((entry) => entry.id === message.id);
      if (index < 0) messages.push(message);
      else messages[index] = message;
    }),
  );
}

/** Ordinals are per content kind, not indexes in the mixed content array. */
function keyedContent(content: AssistantMessage["content"]): Map<string, Part> {
  const result = new Map<string, Part>();
  let text = 0;
  let reasoning = 0;
  for (const part of content) {
    const key =
      part.type === "tool"
        ? `tool:${part.id}`
        : part.type === "text"
          ? `text:${text++}`
          : `reasoning:${reasoning++}`;
    result.set(key, part);
  }
  return result;
}

function mergeMessage(
  snapshot: Message,
  before: Map<string, number>,
  request: number,
  beforeText: Map<string, number>,
): Message {
  const current = store.messages.find((message) => message.id === snapshot.id);
  if ((appliedSnapshots.get(snapshot.id) ?? 0) > request && current)
    return current;
  appliedSnapshots.set(snapshot.id, request);
  if (!current) return snapshot;
  if (before.get(snapshot.id) !== messageRevisions.get(snapshot.id))
    return current;
  if (snapshot.type !== "assistant" || current.type !== "assistant")
    return snapshot;

  const content = keyedContent(snapshot.content);
  let previous: string | undefined;
  const keys = [...content.keys()];
  for (const [key, part] of keyedContent(current.content)) {
    if (!content.has(key)) {
      const index = previous === undefined ? 0 : keys.indexOf(previous) + 1;
      keys.splice(index, 0, key);
      content.set(key, part);
    } else if (part.type !== "tool") {
      const saved = content.get(key);
      if (saved && saved.type !== "tool") {
        const fragment = `${snapshot.id}:${key}`;
        const newer = beforeText.get(fragment) !== textRevisions.get(fragment);
        // Native in-flight text is empty until its durable ended event. An
        // ended fragment (or completed message, including empty text) is
        // authoritative unless THIS fragment changed while fetching it.
        const ended =
          snapshot.time.completed !== undefined ||
          saved.text !== "" ||
          (saved.type === "reasoning" && saved.time?.completed !== undefined);
        if (newer || !ended) content.set(key, { ...saved, text: part.text });
      }
    } else if (part.type === "tool") {
      const saved = content.get(key);
      if (
        saved?.type === "tool" &&
        saved.state.status === "running" &&
        part.state.status === "running"
      ) {
        content.set(key, {
          ...saved,
          state: { ...saved.state, metadata: part.state.metadata },
        });
      } else if (
        saved?.type === "tool" &&
        saved.state.status === "streaming" &&
        part.state.status === "streaming"
      ) {
        content.set(key, {
          ...saved,
          state: {
            ...saved.state,
            input:
              part.state.input.length > saved.state.input.length
                ? part.state.input
                : saved.state.input,
          },
        });
      }
    }
    previous = key;
  }
  const merged: Part[] = [];
  for (const key of keys) {
    const part = content.get(key);
    if (part) merged.push(part);
  }
  return { ...snapshot, content: merged };
}

function flushContent(): void {
  if (raf !== undefined) cancelAnimationFrame(raf);
  raf = undefined;
  setStore(
    "messages",
    produce((messages: Message[]) => {
      for (const [messageID, events] of pendingContent) {
        const message = messages.find((entry) => entry.id === messageID);
        if (message?.type !== "assistant") continue;
        const remaining: ContentEvent[] = [];
        for (const event of events) {
          const data = event.data;
          if ("ordinal" in data) {
            const type = event.type.startsWith("session.reasoning.")
              ? "reasoning"
              : "text";
            let part = message.content.filter((entry) => entry.type === type)[
              data.ordinal
            ];
            // A switch/reconnect can join a fragment midway. The snapshot supplies
            // earlier ordinals; retain these events until that history has arrived.
            if (!part) {
              if (
                message.content.filter((entry) => entry.type === type)
                  .length !== data.ordinal
              ) {
                remaining.push(event);
                continue;
              }
              part =
                type === "text"
                  ? { type, text: "" }
                  : { type, text: "", time: { created: event.created } };
              message.content.push(part);
              part = message.content[message.content.length - 1];
            }
            if (!part || part.type === "tool") continue;
            if ("delta" in data) part.text += data.delta;
            if ("text" in data) part.text = data.text;
            if (
              event.type === "session.reasoning.ended" &&
              part.type === "reasoning"
            ) {
              part.time = {
                created: part.time?.created ?? event.created,
                completed: event.created,
              };
            }
          } else {
            let tool = message.content.find(
              (part) => part.type === "tool" && part.id === data.id,
            );
            if (event.type === "session.tool.input.started" && !tool) {
              message.content.push({
                type: "tool",
                id: event.data.id,
                name: event.data.name,
                time: { created: event.created },
                state: { status: "streaming", input: "" },
              });
              tool = message.content[message.content.length - 1];
            }
            if (tool?.type !== "tool") {
              remaining.push(event);
              continue;
            }
            if (
              event.type === "session.tool.input.delta" &&
              tool.state.status === "streaming"
            ) {
              tool.state.input += event.data.delta;
            } else if (
              event.type === "session.tool.input.ended" &&
              tool.state.status === "streaming"
            ) {
              tool.state.input = event.data.text;
            } else if (
              event.type === "session.tool.progress" &&
              tool.state.status === "running"
            ) {
              tool.state.metadata = event.data.metadata;
            } else if (
              event.type === "session.tool.progress" &&
              tool.state.status === "streaming"
            ) {
              remaining.push(event);
            }
          }
        }
        if (remaining.length) pendingContent.set(messageID, remaining);
        else pendingContent.delete(messageID);
      }
    }),
  );
}

function queueContent(event: ContentEvent): void {
  if (event.data.sessionID !== activeSessionId()) return;
  const messageID = event.data.assistantMessageID;
  touchedMessages.add(messageID);
  if ("ordinal" in event.data) {
    const type = event.type.startsWith("session.reasoning.")
      ? "reasoning"
      : "text";
    bump(textRevisions, `${messageID}:${type}:${event.data.ordinal}`);
  }
  const pending = pendingContent.get(messageID) ?? [];
  pending.push(event);
  pendingContent.set(messageID, pending);
  if (raf === undefined) raf = requestAnimationFrame(flushContent);
  if (!store.messages.some((message) => message.id === messageID)) {
    void refreshMessage(event.data.sessionID, messageID);
  }
}

async function refreshHistory(sessionID: string): Promise<void> {
  if (sessionID !== activeSessionId() || disposed) return;
  const version = generation;
  const request = ++historyRequest;
  const snapshot = ++snapshotRequest;
  const before = new Map(messageRevisions);
  const beforeText = new Map(textRevisions);
  const messages = await fetchMessages(sessionID);
  if (!isCurrent(sessionID, version) || request !== historyRequest) return;
  flushContent();
  const merged = messages.map((message) =>
    mergeMessage(message, before, snapshot, beforeText),
  );
  const ids = new Set(merged.map((message) => message.id));
  // A paginated snapshot may predate messages already observed on the stream.
  for (const message of store.messages) {
    if (
      !ids.has(message.id) &&
      (messageRevisions.has(message.id) ||
        touchedMessages.has(message.id) ||
        (appliedSnapshots.get(message.id) ?? 0) > snapshot)
    )
      merged.push(message);
  }
  merged.sort(
    (a, b) => a.time.created - b.time.created || a.id.localeCompare(b.id),
  );
  replaceMessages(merged);
  flushContent();
}

async function refreshMessage(
  sessionID: string,
  messageID: string,
): Promise<void> {
  if (sessionID !== activeSessionId() || disposed) return;
  dirtyMessages.add(messageID);
  const existing = messageRequests.get(messageID);
  if (existing) return existing;
  const version = generation;
  const request = (async () => {
    do {
      dirtyMessages.delete(messageID);
      const before = new Map(messageRevisions);
      const beforeText = new Map(textRevisions);
      const snapshot = ++snapshotRequest;
      const message = await client.session.message.get({
        sessionID,
        messageID,
      });
      if (!isCurrent(sessionID, version)) return;
      flushContent();
      upsertMessage(mergeMessage(message, before, snapshot, beforeText));
      flushContent();
    } while (dirtyMessages.has(messageID));
  })();
  messageRequests.set(messageID, request);
  try {
    await request;
  } finally {
    if (messageRequests.get(messageID) === request)
      messageRequests.delete(messageID);
  }
}

function setStatus(
  sessionID: string,
  status: SessionStatus,
  clearError = true,
): void {
  bump(revisions, sessionID);
  bump(statusRevisions, sessionID);
  setStore("sessionStatuses", sessionID, reconcile(status));
  if (clearError && status.type === "busy") setError(sessionID, undefined);
}

function setError(sessionID: string, error: string | undefined): void {
  setStore(
    "sessionErrors",
    produce((errors) => {
      if (error === undefined) delete errors[sessionID];
      else errors[sessionID] = error;
    }),
  );
  if (sessionID === activeSessionId()) {
    setStore("sessionError", error !== undefined);
    setStore("errorMessage", error ?? null);
  }
}

async function refreshStatus(sessionID: string): Promise<void> {
  const revision = statusRevisions.get(sessionID);
  const active = await client.session.active();
  if (
    disposed ||
    deletedSessions.has(sessionID) ||
    statusRevisions.get(sessionID) !== revision
  )
    return;
  // active() has no retry details. Keep those until a status event resolves them.
  const previous = store.sessionStatuses[sessionID];
  setStatus(
    sessionID,
    active[sessionID]?.type === "running"
      ? previous?.type === "retry"
        ? previous
        : { type: "busy" }
      : { type: "idle" },
    false,
  );
}

async function refreshSession(sessionID: string): Promise<void> {
  const request = bump(metadataRequests, sessionID);
  const session = await client.session.get({ sessionID });
  if (
    disposed ||
    deletedSessions.has(sessionID) ||
    metadataRequests.get(sessionID) !== request
  )
    return;
  setStore(
    "sessions",
    produce((sessions) => {
      const index = sessions.findIndex((entry) => entry.id === sessionID);
      if (session.time.archived) {
        if (index >= 0) sessions.splice(index, 1);
      } else if (index < 0) sessions.push(session);
      else sessions[index] = session;
      sessions.sort((a, b) => b.time.updated - a.time.updated);
    }),
  );
}

async function refreshPending(sessionID: string): Promise<void> {
  const request = bump(pendingRequests, sessionID);
  const [permissions, forms] = await Promise.all([
    fetchPendingPermissions(sessionID),
    client.session.form.list({ sessionID }),
  ]);
  const details = await Promise.all(
    forms.map((form) =>
      client.session.form.get({ sessionID, formID: form.id }),
    ),
  );
  if (
    disposed ||
    deletedSessions.has(sessionID) ||
    pendingRequests.get(sessionID) !== request
  )
    return;
  batch(() => {
    setStore(
      "sessionPermissions",
      produce((pending) => {
        delete pending[sessionID];
        const next = permissions.find(
          (permission) => permission.sessionID === sessionID,
        );
        if (next) pending[sessionID] = next;
      }),
    );
    setStore(
      "sessionQuestions",
      produce((pending) => {
        delete pending[sessionID];
        const next = details.find((form) => form.state.status === "pending");
        if (next) pending[sessionID] = next;
      }),
    );
  });
}

async function refreshFiles(): Promise<void> {
  const sessionID = activeSessionId();
  const directory = activeSession()?.location.directory;
  if (!sessionID || !directory) return;
  const version = generation;
  const request = ++filesRequest;
  const [branch, files] = await Promise.all([
    fetchGitBranch(directory),
    fetchFileStatus(directory),
  ]);
  if (
    !isCurrent(sessionID, version) ||
    request !== filesRequest ||
    activeSession()?.location.directory !== directory
  )
    return;
  batch(() => {
    setStore("gitBranch", branch);
    setStore("changedFiles", files);
  });
}

async function reconcileConnection(): Promise<void> {
  const request = ++reconnectRequest;
  const before = new Map(revisions);
  const statusesBefore = new Map(statusRevisions);
  const boot = await init();
  if (disposed || request !== reconnectRequest) return;
  const unchanged = (id: string) => before.get(id) === revisions.get(id);
  function crossSession<T>(
    snapshot: Record<string, T>,
    current: Record<string, T>,
  ): Record<string, T> {
    const result = { ...snapshot };
    for (const id of new Set([
      ...Object.keys(snapshot),
      ...Object.keys(current),
    ])) {
      if (!unchanged(id)) {
        delete result[id];
        const value = current[id];
        if (value !== undefined) result[id] = value;
      }
      if (deletedSessions.has(id)) delete result[id];
    }
    return result;
  }
  batch(() => {
    const sessions = boot.sessions.filter(
      (session) => unchanged(session.id) && !deletedSessions.has(session.id),
    );
    sessions.push(
      ...store.sessions.filter((session) => !unchanged(session.id)),
    );
    sessions.sort((a, b) => b.time.updated - a.time.updated);
    setStore("sessions", reconcile(sessions));
    setStore("agents", reconcile(boot.agents));
    setStore("projects", reconcile(boot.projects));
    setStore("currentProject", boot.currentProject);
    setStore(
      "sessionStatuses",
      reconcile(crossSession(boot.sessionStatuses, store.sessionStatuses)),
    );
    setStore(
      "sessionPermissions",
      reconcile(
        crossSession(boot.sessionPermissions, store.sessionPermissions),
      ),
    );
    setStore(
      "sessionQuestions",
      reconcile(crossSession(boot.sessionQuestions, store.sessionQuestions)),
    );
    for (const session of sessions) {
      if (unchanged(session.id)) bump(metadataRequests, session.id);
      if (statusesBefore.get(session.id) === statusRevisions.get(session.id)) {
        bump(statusRevisions, session.id);
        setStore(
          "sessionStatuses",
          session.id,
          reconcile(boot.sessionStatuses[session.id] ?? { type: "idle" }),
        );
      }
    }
    // Bootstrap has no historical error detail. Retain known failures only for
    // surviving sessions, rather than replacing active UI state with boot defaults.
    setStore(
      "sessionErrors",
      produce((errors) => {
        for (const id of Object.keys(errors)) {
          if (
            !sessions.some((session) => session.id === id) ||
            (unchanged(id) &&
              (boot.sessionStatuses[id]?.type === "busy" ||
                sessions.find((session) => session.id === id)?.outcome ===
                  "succeeded"))
          )
            delete errors[id];
        }
      }),
    );
  });
  const sessionID = activeSessionId();
  if (sessionID) setError(sessionID, store.sessionErrors[sessionID]);
  // Include session locations (worktrees too), not only bootstrap project roots.
  await Promise.all([
    ...Object.entries(store.sessionStatuses)
      .filter(([, status]) => status.type !== "idle")
      .map(([sessionID]) => refreshPending(sessionID)),
    sessionID ? refreshHistory(sessionID) : Promise.resolve(),
    refreshFiles(),
  ]);
}

function finishSession(sessionID: string): void {
  flushContent();
  setStatus(sessionID, { type: "idle" });
  void refreshStatus(sessionID);
  void refreshHistory(sessionID);
  void refreshSession(sessionID);
  setStore(
    "sessionPermissions",
    produce((pending) => {
      delete pending[sessionID];
    }),
  );
  setStore(
    "sessionQuestions",
    produce((pending) => {
      delete pending[sessionID];
    }),
  );
  if (sessionID === activeSessionId()) void refreshFiles();
}

function handleEvent(event: Event): void {
  if (disposed) return;
  const data: unknown = event.data;
  if (
    typeof data === "object" &&
    data !== null &&
    "sessionID" in data &&
    typeof data.sessionID === "string"
  ) {
    bump(revisions, data.sessionID);
  }
  switch (event.type) {
    case "server.connected":
      void reconcileConnection();
      break;
    case "session.step.started": {
      const data = event.data;
      setStatus(data.sessionID, { type: "busy" });
      if (data.sessionID !== activeSessionId()) break;
      flushContent();
      bump(messageRevisions, data.assistantMessageID);
      const existing = store.messages.find(
        (message) => message.id === data.assistantMessageID,
      );
      upsertMessage({
        id: data.assistantMessageID,
        type: "assistant",
        agent: data.agent,
        model: data.model,
        time: { created: data.started },
        content: existing?.type === "assistant" ? existing.content : [],
        snapshot: data.snapshot ? { start: data.snapshot } : undefined,
      });
      flushContent();
      break;
    }
    case "session.text.started":
    case "session.text.delta":
    case "session.text.ended":
    case "session.reasoning.started":
    case "session.reasoning.delta":
    case "session.reasoning.ended":
      queueContent(event);
      break;
    case "session.tool.input.started":
    case "session.tool.input.delta":
    case "session.tool.input.ended":
    case "session.tool.progress":
      queueContent(event);
      if (
        event.type === "session.tool.input.delta" ||
        event.type === "session.tool.progress"
      )
        break;
      void refreshMessage(event.data.sessionID, event.data.assistantMessageID);
      break;
    case "session.tool.called":
    case "session.tool.success":
    case "session.tool.failed":
    case "session.step.streamed":
    case "session.step.ended":
    case "session.step.failed":
      if (event.data.sessionID === activeSessionId())
        bump(messageRevisions, event.data.assistantMessageID);
      void refreshMessage(event.data.sessionID, event.data.assistantMessageID);
      break;
    case "session.retry.scheduled":
      setStatus(event.data.sessionID, {
        type: "retry",
        attempt: event.data.attempt,
        next: event.data.at,
        message: event.data.error.message,
      });
      void refreshMessage(event.data.sessionID, event.data.assistantMessageID);
      break;
    case "session.status":
      setStatus(event.data.sessionID, event.data.status);
      if (event.data.status.type === "idle")
        finishSession(event.data.sessionID);
      break;
    case "session.execution.started":
      setStatus(event.data.sessionID, { type: "busy" });
      break;
    case "session.execution.failed":
      setError(event.data.sessionID, event.data.error.message);
      finishSession(event.data.sessionID);
      break;
    case "session.execution.succeeded":
      setError(event.data.sessionID, undefined);
      finishSession(event.data.sessionID);
      break;
    case "session.execution.interrupted":
    case "session.idle":
      finishSession(event.data.sessionID);
      break;
    case "permission.asked":
      void refreshPending(event.data.sessionID);
      break;
    case "permission.replied":
      setStore(
        "sessionPermissions",
        produce((pending) => {
          delete pending[event.data.sessionID];
        }),
      );
      void refreshPending(event.data.sessionID);
      break;
    case "form.created":
      bump(revisions, event.data.form.sessionID);
      void refreshPending(event.data.form.sessionID);
      break;
    case "form.replied":
    case "form.cancelled":
      setStore(
        "sessionQuestions",
        produce((pending) => {
          delete pending[event.data.sessionID];
        }),
      );
      void refreshPending(event.data.sessionID);
      break;
    case "session.created":
    case "session.forked":
      deletedSessions.delete(event.data.sessionID);
      void refreshSession(event.data.sessionID);
      break;
    case "session.deleted": {
      const sessionID = event.data.sessionID;
      deletedSessions.add(sessionID);
      batch(() => {
        setStore("sessions", (sessions) =>
          sessions.filter((session) => session.id !== sessionID),
        );
        setStore(
          produce((state) => {
            delete state.sessionStatuses[sessionID];
            delete state.sessionPermissions[sessionID];
            delete state.sessionQuestions[sessionID];
            delete state.sessionErrors[sessionID];
          }),
        );
      });
      break;
    }
    case "session.renamed":
    case "session.metadata.updated":
    case "session.permissions":
    case "session.viewed":
    case "session.usage.updated":
      void refreshSession(event.data.sessionID);
      break;
    case "session.agent.selected":
    case "session.model.selected":
    case "session.moved":
      void refreshSession(event.data.sessionID);
      void refreshHistory(event.data.sessionID);
      break;
    case "session.inbox.delivered":
    case "session.synthetic":
    case "session.instructions.updated":
    case "session.skill.activated":
    case "session.shell.started":
    case "session.shell.ended":
    case "session.compaction.started":
    case "session.compaction.ended":
    case "session.compaction.failed":
    case "session.revert.staged":
    case "session.revert.cleared":
    case "session.revert.committed":
      if (
        event.type === "session.revert.committed" &&
        event.data.sessionID === activeSessionId()
      )
        resetActive();
      void refreshHistory(event.data.sessionID);
      void refreshSession(event.data.sessionID);
      break;
    case "filesystem.changed":
    case "vcs.branch.updated":
      if (
        !event.location ||
        event.location.directory !== activeSession()?.location.directory
      )
        break;
      if (event.type === "vcs.branch.updated") {
        ++filesRequest;
        setStore("gitBranch", event.data.branch ?? null);
      }
      if (filesTimer !== undefined) clearTimeout(filesTimer);
      filesTimer = setTimeout(() => {
        filesTimer = undefined;
        void refreshFiles();
      }, 500);
      break;
    case "agent.updated":
    case "project.updated":
    case "worktree.updated":
    case "worktree.resolved":
      void reconcileConnection();
      break;
  }
}

function resetActive(): void {
  ++generation;
  ++filesRequest;
  if (raf !== undefined) cancelAnimationFrame(raf);
  if (filesTimer !== undefined) clearTimeout(filesTimer);
  raf = undefined;
  filesTimer = undefined;
  pendingContent.clear();
  touchedMessages.clear();
  textRevisions.clear();
  messageRevisions.clear();
  appliedSnapshots.clear();
  messageRequests.clear();
  dirtyMessages.clear();
  replaceMessages([]);
  setStore("gitBranch", null);
  setStore("changedFiles", []);
}

const dispose = createRoot((dispose) => {
  createEffect(
    on(activeSessionId, (sessionID) => {
      resetActive();
      setStore(
        "sessionError",
        sessionID ? store.sessionErrors[sessionID] !== undefined : false,
      );
      setStore(
        "errorMessage",
        sessionID ? (store.sessionErrors[sessionID] ?? null) : null,
      );
      if (sessionID) {
        void refreshHistory(sessionID);
        void refreshStatus(sessionID);
        if (store.sessionStatuses[sessionID]?.type !== undefined) {
          void refreshPending(sessionID);
        }
      }
    }),
  );
  createEffect(
    on(
      () => activeSession()?.location.directory,
      () => {
        void refreshFiles();
      },
    ),
  );
  return dispose;
});

addEventListener(handleEvent);
startEventStream();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    removeEventListener(handleEvent);
    dispose();
    if (raf !== undefined) cancelAnimationFrame(raf);
    if (filesTimer !== undefined) clearTimeout(filesTimer);
  });
}

export async function sendUserMessage(content: string): Promise<boolean> {
  const sessionID = activeSessionId();
  if (!sessionID) return false;
  const previous: SessionStatus = {
    ...(store.sessionStatuses[sessionID] ?? { type: "idle" }),
  };
  setError(sessionID, undefined);
  setStatus(sessionID, { type: "busy" });
  const revision = statusRevisions.get(sessionID);
  try {
    // Inbox delivery supplies the canonical user message; avoid a duplicate
    // optimistic entry while the input is being admitted.
    await sendPromptAsync(
      sessionID,
      content,
      effectiveAgent(),
      selectedModel(),
    );
    void refreshHistory(sessionID);
    return true;
  } catch (error: unknown) {
    if (!deletedSessions.has(sessionID)) {
      if (statusRevisions.get(sessionID) === revision)
        setStatus(sessionID, previous);
      else void refreshStatus(sessionID);
      setError(
        sessionID,
        error instanceof Error ? error.message : "Failed to send message",
      );
    }
    throw error;
  }
}

export async function abortCurrentSession(): Promise<void> {
  const sessionID = activeSessionId();
  if (!sessionID) return;
  await abortSession(sessionID);
  await Promise.all([
    refreshStatus(sessionID),
    refreshHistory(sessionID),
    refreshSession(sessionID),
    refreshPending(sessionID),
  ]);
}
