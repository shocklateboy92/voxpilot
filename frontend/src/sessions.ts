/**
 * Session orchestration.
 *
 * Coordinates session switching, creation, deletion with
 * the store signals and streaming manager.
 */

import {
  createSession,
  deleteSession,
} from "./api-client";
import {
  activeRootIndex,
  activeSessionId,
  refetchSessions,
  rootSessions,
  sessions,
  setActiveSessionId,
  setErrorMessage,
  setIsStreaming,
  setPickerOpen,
} from "./store";
import { openStream } from "./streaming";

/**
 * Switch to the session at the given index.
 * Closes any existing stream and opens a new one.
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
 * Updates the URL hash, resets streaming state, and opens the event stream.
 */
export function switchToSession(sessionId: string): void {
  if (activeSessionId() === sessionId) return;

  setActiveSessionId(sessionId);
  setIsStreaming(false);
  setErrorMessage(null);

  openStream(sessionId);
}

/** Navigate to the next root session (if any). */
export function navigateNext(): void {
  const roots = rootSessions();
  const idx = activeRootIndex();
  if (idx < 0) return;
  const next = idx + 1;
  if (next < roots.length) {
    const target = roots[next];
    if (target) switchToSession(target.id);
  }
}

/** Navigate to the previous root session (if any). */
export function navigatePrev(): void {
  const roots = rootSessions();
  const idx = activeRootIndex();
  if (idx < 0) return;
  const prev = idx - 1;
  if (prev >= 0) {
    const target = roots[prev];
    if (target) switchToSession(target.id);
  }
}

/** Create a new session and switch to it. */
export async function handleNewSession(): Promise<void> {
  const session = await createSession();
  await refetchSessions();
  switchToSession(session.id);
}

/** Delete a session and adjust navigation. */
export async function handleDeleteSession(sessionId: string): Promise<void> {
  await deleteSession(sessionId);
  await refetchSessions();

  if (sessions().length === 0) {
    await createSession();
    await refetchSessions();
  }

  const list = sessions();

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
}

/**
 * Initialize sessions on login.
 * Fetches the session list, creates one if empty.
 * Restores the previously selected session from the URL hash,
 * or falls back to the first session.
 */
export async function initSessions(): Promise<void> {
  await refetchSessions();

  if (sessions().length === 0) {
    await createSession();
    await refetchSessions();
  }

  const hashId = activeSessionId();
  const list = sessions();
  const target =
    hashId && list.some((s) => s.id === hashId) ? hashId : list[0]!.id;

  // Always open the stream on init — bypass switchToSession's same-ID guard,
  // which would skip openStream when the URL hash already matches (e.g. page reload).
  setActiveSessionId(target);
  setIsStreaming(false);
  setErrorMessage(null);
  openStream(target);
}
