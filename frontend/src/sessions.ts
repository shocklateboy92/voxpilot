/**
 * Session orchestration.
 *
 * Coordinates session switching, creation, deletion with
 * the store signals and streaming manager.
 */

import { createSession, deleteSession, fetchSessions } from "./api-client";
import {
  activeIndex,
  activeSessionId,
  sessions,
  setActiveSessionId,
  setErrorMessage,
  setIsStreaming,
  setPendingPermission,
  setPickerOpen,
  setSessions,
  setStreamingParts,
  setStreamingText,
} from "./store";
import { openStream } from "./streaming";

// ── URL hash helpers ──────────────────────────────────────────────

/** Read session ID from the URL hash (e.g. "#abc123" → "abc123"). */
export function getSessionIdFromHash(): string | undefined {
  const hash = window.location.hash.slice(1);
  return hash || undefined;
}

/** Write session ID to the URL hash without triggering navigation. */
function setHashSessionId(sessionId: string): void {
  history.replaceState(null, "", `#${sessionId}`);
}

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
  setHashSessionId(sessionId);
  setStreamingText(null);
  setStreamingParts([]);
  setIsStreaming(false);
  setErrorMessage(null);
  setPendingPermission(null);

  openStream(sessionId);
}

/** Navigate to the next session (if any). */
export function navigateNext(): void {
  const next = activeIndex() + 1;
  if (next < sessions().length) {
    switchToIndex(next);
  }
}

/** Navigate to the previous session (if any). */
export function navigatePrev(): void {
  const prev = activeIndex() - 1;
  if (prev >= 0) {
    switchToIndex(prev);
  }
}

/** Create a new session and switch to it. */
export async function handleNewSession(): Promise<void> {
  const session = await createSession();
  const list = await fetchSessions();
  setSessions(list);
  switchToSession(session.id);
}

/** Delete a session and adjust navigation. */
export async function handleDeleteSession(sessionId: string): Promise<void> {
  await deleteSession(sessionId);
  let list = await fetchSessions();

  if (list.length === 0) {
    const fresh = await createSession();
    list = [fresh];
  }

  setSessions(list);

  // If we deleted the active session, switch to the nearest one
  const currentId = activeSessionId();
  if (currentId === sessionId || !list.some((s) => s.id === currentId)) {
    const oldIdx = activeIndex();
    const newIdx = Math.min(oldIdx, list.length - 1);
    const target = list[Math.max(newIdx, 0)];
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
  let list = await fetchSessions();
  if (list.length === 0) {
    const fresh = await createSession();
    list = [fresh];
  }
  setSessions(list);

  const hashId = getSessionIdFromHash();
  const target =
    hashId && list.some((s) => s.id === hashId) ? hashId : list[0]!.id;
  switchToSession(target);
}
