/**
 * Session orchestration.
 *
 * Coordinates session switching, creation, deletion with
 * the store signals and streaming manager.
 */

import {
  sessions,
  setSessions,
  activeIndex,
  setActiveIndex,
  setStreamingText,
  setStreamingToolCalls,
  setIsStreaming,
  setErrorMessage,
  setPickerOpen,
} from "./store";
import { fetchSessions, createSession, deleteSession } from "./api-client";
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

  setActiveIndex(index);
  setStreamingText(null);
  setStreamingToolCalls([]);
  setIsStreaming(false);
  setErrorMessage(null);

  openStream(session.id);
}

/**
 * Switch to a session by ID.
 */
export function switchToSession(sessionId: string): void {
  const index = sessions().findIndex((s) => s.id === sessionId);
  if (index >= 0) {
    switchToIndex(index);
  }
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
  const index = list.findIndex((s) => s.id === session.id);
  switchToIndex(index >= 0 ? index : 0);
}

/** Delete a session and adjust navigation. */
export async function handleDeleteSession(sessionId: string): Promise<void> {
  await deleteSession(sessionId);
  let list = await fetchSessions();

  if (list.length === 0) {
    // Create a fresh session if all were deleted
    const fresh = await createSession();
    list = [fresh];
  }

  setSessions(list);

  // If we deleted the active session, switch to the nearest one
  const currentId = sessions()[activeIndex()]?.id;
  if (currentId === sessionId || !currentId) {
    const newIndex = Math.min(activeIndex(), list.length - 1);
    switchToIndex(Math.max(newIndex, 0));
  }

  setPickerOpen(false);
}

/**
 * Initialize sessions on login.
 * Fetches the session list, creates one if empty, and switches to the first.
 */
export async function initSessions(): Promise<void> {
  let list = await fetchSessions();
  if (list.length === 0) {
    const fresh = await createSession();
    list = [fresh];
  }
  setSessions(list);
  switchToIndex(0);
}
