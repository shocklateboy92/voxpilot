/**
 * Session navigation — router-derived activeSessionId,
 * session switching, creation, deletion, and derived accessors
 * that depend on activeSessionId.
 */

import { batch, createEffect, on } from "solid-js";
import { produce } from "solid-js/store";
import { discardComposerDraft } from "../features/chat/create-composer-draft";
import {
  setSelectedModelKey,
  setSelectedModelVariant,
} from "../features/chat/preferences";
import { clearFileRoute } from "../features/files/file-links";
import {
  createSession,
  deleteSession,
  type ModelRef,
  sendPromptAsync,
} from "../platform/api-client";
import type { PromptContent } from "../platform/prompt-files";
import { appLocation, appUrl, navigateApp } from "./routing";
import { setStore, store } from "./store";

// ── Active session ID ───────────────────────────────────────────

/** ID of the currently active session. */
export const activeSessionId = () => appLocation()?.hash.slice(1) || undefined;

function navigateSession(sessionID: string | undefined, replace = false): void {
  const url = appUrl();
  clearFileRoute(url);
  url.hash = sessionID ?? "";
  navigateApp(url.href, { replace });
}

/** Resolve a server-switch landing hint before mounting the chat route. */
export function useSessionLanding() {
  const pending = () => appUrl().searchParams.get("open") === "latest";
  createEffect(() => {
    if (!pending()) return;
    const url = appUrl();
    url.searchParams.delete("open");
    if (!url.hash && !url.searchParams.has("file")) {
      url.hash = rootSessions()[0]?.id ?? "";
    }
    navigateApp(url.href, { replace: true });
  });
  return () => !pending();
}

/** Mount session lifecycle effects under the router, before rendering pickers. */
export function useSessionNavigation(): void {
  // ── Session validation ────────────────────────────────────────
  //
  // Reactive session validation: if activeSessionId points to a session
  // that doesn't exist in the store, redirect to the new session page.
  //
  // With the spinner gate, sessions are always loaded before the UI
  // renders, so no .loading guard is needed.
  createEffect(() => {
    const id = activeSessionId();
    if (id === undefined) return; // Already on new session page
    if (!store.sessions.some((s) => s.id === id)) {
      navigateSession(undefined, true);
    }
  });

  function restoreModel(id: string | undefined): void {
    if (!id) return; // New conversations keep the persisted preference.
    const session = store.sessions.find((entry) => entry.id === id);
    if (!session) return;
    const model = session.model;
    batch(() => {
      setSelectedModelKey(model ? `${model.providerID}/${model.id}` : "");
      setSelectedModelVariant(model?.variant ?? "");
    });
  }
  // Initialize before select elements mount; otherwise their value can be set
  // while options still belong to the previous global model preference.
  restoreModel(activeSessionId());
  // Only track navigation, not metadata updates or explicit picker choices.
  createEffect(on(activeSessionId, restoreModel, { defer: true }));
}

// ── Derived accessors ───────────────────────────────────────────
// These combine activeSessionId with store data. They live here
// (rather than store.ts) to keep the dependency one-way:
// navigation.ts → store.ts (no circular imports).

/** The currently active session summary, or undefined. */
export const activeSession = () => {
  const id = activeSessionId();
  return store.sessions.find((s) => s.id === id);
};

/** Top-level (root) sessions only — sessions without a parentID. */
export const rootSessions = () => {
  return store.sessions.filter((s) => !s.parentID);
};

/** Whether we're on the "new session" page (no active session selected). */
export const isNewSessionPage = () => activeSessionId() === undefined;

/**
 * Index of the active session within rootSessions(), or -1 if on the new session page.
 * Layout: [new session page (-1)] [0: most recent] [1] ... [N-1: oldest]
 */
export const activeRootIndex = () => {
  const id = activeSessionId();
  if (!id) return -1;
  const idx = rootSessions().findIndex((s) => s.id === id);
  return idx >= 0 ? idx : -1;
};

/** Whether we're waiting for an assistant response (derived from messages store). */
export const isStreaming = () => {
  if (store.sessionError) return false;
  const id = activeSessionId();
  const status = id ? store.sessionStatuses[id] : undefined;
  return status?.type === "busy" || status?.type === "retry";
};

/** Pending permission for the active session (derived from cross-session store). */
export const pendingPermission = () => {
  const id = activeSessionId();
  if (!id) return null;
  return store.sessionPermissions[id] ?? null;
};

/** Pending question for the active session (derived from cross-session store). */
export const pendingQuestion = () => {
  const id = activeSessionId();
  if (!id) return null;
  return store.sessionQuestions[id] ?? null;
};

/** Whether a session needs attention (permission, question, error, or waiting). */
export function sessionNeedsAttention(id: string): boolean {
  return (
    id in store.sessionPermissions ||
    id in store.sessionQuestions ||
    id in store.sessionErrors
  );
}

// ── Navigation helpers ──────────────────────────────────────────

/**
 * Switch to the session at the given index.
 */
export function switchToIndex(index: number): void {
  const list = store.sessions;
  if (index < 0 || index >= list.length) return;

  const session = list[index];
  if (!session) return;

  switchToSession(session.id);
}

/**
 * Switch to a session by ID.
 * Updates the URL hash and resets error state.
 */
export function switchToSession(sessionId: string): void {
  if (activeSessionId() === sessionId) return;

  navigateSession(sessionId);
  setStore("errorMessage", null);
}

/** Whether the active session is a child (sub-agent) with a parent to navigate to. */
function isChildSession(): boolean {
  return Boolean(activeSession()?.parentID);
}

/** Whether a swipe-next gesture has somewhere to go. */
export function canNavigateNext(): boolean {
  if (isChildSession()) return true;
  if (isNewSessionPage()) return rootSessions().length > 0;
  const idx = activeRootIndex();
  return idx >= 0 && idx < rootSessions().length - 1;
}

/** Whether a swipe-prev gesture has somewhere to go. */
export function canNavigatePrev(): boolean {
  if (isChildSession()) return true;
  if (isNewSessionPage()) return false;
  return true;
}

/** Navigate to the next root session (toward older). */
export function navigateNext(): void {
  if (isChildSession()) {
    const parentId = activeSession()?.parentID;
    if (parentId) switchToSession(parentId);
    return;
  }
  const roots = rootSessions();
  if (isNewSessionPage()) {
    const first = roots[0];
    if (first) switchToSession(first.id);
    return;
  }
  const idx = activeRootIndex();
  if (idx < 0) return;
  const next = idx + 1;
  if (next < roots.length) {
    const target = roots[next];
    if (target) switchToSession(target.id);
  }
}

/** Navigate to the previous root session (toward newer) or new session page. */
export function navigatePrev(): void {
  if (isChildSession()) {
    const parentId = activeSession()?.parentID;
    if (parentId) switchToSession(parentId);
    return;
  }
  if (isNewSessionPage()) return;
  const roots = rootSessions();
  const idx = activeRootIndex();
  if (idx < 0) return;
  const prev = idx - 1;
  if (prev >= 0) {
    const target = roots[prev];
    if (target) switchToSession(target.id);
  } else {
    navigateToNewSession();
  }
}

/** Navigate to the new session page. */
export function handleNewSession(): void {
  navigateToNewSession();
}

/** Navigate to the new session page (clears active session). */
export function navigateToNewSession(): void {
  navigateSession(undefined);
  setStore("errorMessage", null);
}

// ── Session lifecycle ───────────────────────────────────────────

/**
 * Create a new session, send the first message, and switch to it.
 * Optimistically inserts the session into the store.
 */
export async function createSessionAndSend(
  content: PromptContent,
  agent: string,
  directory?: string,
  model?: ModelRef,
  variant?: string,
  onCreated?: (sessionID: string) => void,
): Promise<void> {
  const selected = model
    ? { ...model, variant: variant ?? model.variant }
    : undefined;
  const session = await createSession(undefined, directory, agent, selected);

  // Optimistically insert the new session
  setStore(
    "sessions",
    produce((list) => {
      if (list.some((s) => s.id === session.id)) return; // already exists
      list.push(session);
      list.sort((a, b) => b.time.updated - a.time.updated);
    }),
  );

  onCreated?.(session.id);
  navigateSession(session.id);
  setStore("sessionStatuses", session.id, { type: "busy" });
  try {
    await sendPromptAsync(session.id, content);
  } catch (error) {
    setStore("sessionStatuses", session.id, { type: "idle" });
    throw error;
  }
}

/** Delete a session and adjust navigation. */
export async function handleDeleteSession(sessionId: string): Promise<void> {
  await deleteSession(sessionId);
  discardComposerDraft(sessionId);

  // Remove from store synchronously
  setStore("sessions", (prev) => prev.filter((s) => s.id !== sessionId));
  setStore(
    "sessionStatuses",
    produce((draft) => {
      delete draft[sessionId];
    }),
  );
  setStore(
    "sessionPermissions",
    produce((draft) => {
      delete draft[sessionId];
    }),
  );
  setStore(
    "sessionQuestions",
    produce((draft) => {
      delete draft[sessionId];
    }),
  );
  setStore(
    "sessionErrors",
    produce((draft) => {
      delete draft[sessionId];
    }),
  );

  const list = store.sessions;

  if (list.length === 0) {
    navigateToNewSession();
    return;
  }

  // If we deleted the active session, switch to the nearest one
  const currentId = activeSessionId();
  if (currentId === sessionId || !list.some((s) => s.id === currentId)) {
    const oldIdx = list.findIndex((s) => s.id === currentId);
    const newIdx = Math.min(Math.max(oldIdx, 0), list.length - 1);
    const target = list[newIdx];
    if (target) {
      switchToSession(target.id);
    }
  }
}
