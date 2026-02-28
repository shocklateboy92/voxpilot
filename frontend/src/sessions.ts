/**
 * Session orchestration.
 *
 * Coordinates session switching, creation, deletion with
 * the store signals. Message loading and SSE streaming are
 * handled reactively by streaming.ts based on activeSessionId.
 */

import {
  createSession,
  deleteSession,
  sendPromptAsync,
} from "./api-client";
import {
  activeRootIndex,
  activeSession,
  activeSessionId,
  clearScrollPosition,
  isNewSessionPage,
  refetchSessions,
  rootSessions,
  saveCurrentScrollPosition,
  sessions,
  setActiveSessionId,
  setErrorMessage,
  setPickerOpen,
} from "./store";

/**
 * Switch to the session at the given index.
 */
export function switchToIndex(index: number): void {
  const list = sessions();
  if (index < 0 || index >= list.length) return;

  const session = list[index];
  if (!session) return;

  switchToSession(session.id);
}

/**
 * Switch to a session by ID.
 * Updates the URL hash and resets error state.
 * The reactive effect in streaming.ts handles message loading and stream filtering.
 */
export function switchToSession(sessionId: string): void {
  if (activeSessionId() === sessionId) return;

  saveCurrentScrollPosition();
  setActiveSessionId(sessionId);
  setErrorMessage(null);
}

/** Whether the active session is a child (sub-agent) with a parent to navigate to. */
function isChildSession(): boolean {
  return Boolean(activeSession()?.parentID);
}

/** Whether a swipe-next gesture has somewhere to go (includes new session page). */
export function canNavigateNext(): boolean {
  if (isChildSession()) return true;
  const idx = activeRootIndex();
  // Allow navigating to the new session page (one past the last root)
  return idx >= 0 && idx < rootSessions().length;
}

/** Whether a swipe-prev gesture has somewhere to go (includes back from new session page). */
export function canNavigatePrev(): boolean {
  if (isChildSession()) return true;
  if (isNewSessionPage()) return rootSessions().length > 0;
  return activeRootIndex() > 0;
}

/** Navigate to the next root session or the new session page, or to the parent if in a sub-agent session. */
export function navigateNext(): void {
  if (isChildSession()) {
    const parentId = activeSession()?.parentID;
    if (parentId) switchToSession(parentId);
    return;
  }
  const roots = rootSessions();
  const idx = activeRootIndex();
  if (idx < 0) return;
  const next = idx + 1;
  if (next < roots.length) {
    const target = roots[next];
    if (target) switchToSession(target.id);
  } else if (next === roots.length) {
    // Navigate past the last session → new session page
    navigateToNewSession();
  }
}

/** Navigate to the previous root session, or to the parent if in a sub-agent session. */
export function navigatePrev(): void {
  if (isChildSession()) {
    const parentId = activeSession()?.parentID;
    if (parentId) switchToSession(parentId);
    return;
  }
  // If on the new session page, go back to the last root session
  if (isNewSessionPage()) {
    const roots = rootSessions();
    const last = roots[roots.length - 1];
    if (last) switchToSession(last.id);
    return;
  }
  const roots = rootSessions();
  const idx = activeRootIndex();
  if (idx < 0) return;
  const prev = idx - 1;
  if (prev >= 0) {
    const target = roots[prev];
    if (target) switchToSession(target.id);
  }
}

/** Navigate to the new session page. */
export function handleNewSession(): void {
  navigateToNewSession();
}

/** Navigate to the new session page (clears active session). */
export function navigateToNewSession(): void {
  saveCurrentScrollPosition();
  setActiveSessionId(undefined);
  setErrorMessage(null);
}

/**
 * Create a new session, send the first message, and switch to it.
 * Used by NewSessionPage when the user types their first message.
 *
 * Setting activeSessionId triggers the reactive message-loading effect
 * in streaming.ts — no explicit openStream needed.
 */
export async function createSessionAndSend(
  content: string,
  agent: string,
): Promise<void> {
  const session = await createSession();
  await refetchSessions();
  setActiveSessionId(session.id);
  await sendPromptAsync(session.id, content, agent);
}

/** Delete a session and adjust navigation. */
export async function handleDeleteSession(sessionId: string): Promise<void> {
  await deleteSession(sessionId);
  const list = (await refetchSessions()) ?? [];

  if (list.length === 0) {
    // No sessions left — show the new session page
    navigateToNewSession();
    setPickerOpen(false);
    clearScrollPosition(sessionId);
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

  setPickerOpen(false);
  clearScrollPosition(sessionId);
}
