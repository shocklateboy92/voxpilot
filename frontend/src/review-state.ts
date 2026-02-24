/**
 * Local storage for review state (viewed files, comments).
 */

export interface FileComment {
  lineId: string;
  text: string;
  createdAt: string;
}

export interface FileReviewState {
  viewed: boolean;
  comments: FileComment[];
}

function storageKey(sessionId: string, filePath: string): string {
  return `voxpilot:review:${sessionId}:${filePath}`;
}

export function getFileState(
  sessionId: string,
  filePath: string,
): FileReviewState {
  try {
    const raw = localStorage.getItem(storageKey(sessionId, filePath));
    if (raw) return JSON.parse(raw) as FileReviewState;
  } catch {
    /* ignore */
  }
  return { viewed: false, comments: [] };
}

function saveFileState(
  sessionId: string,
  filePath: string,
  state: FileReviewState,
): void {
  localStorage.setItem(storageKey(sessionId, filePath), JSON.stringify(state));
}

export function markViewed(sessionId: string, filePath: string): void {
  const state = getFileState(sessionId, filePath);
  state.viewed = true;
  saveFileState(sessionId, filePath, state);
}

export function toggleViewed(sessionId: string, filePath: string): void {
  const state = getFileState(sessionId, filePath);
  state.viewed = !state.viewed;
  saveFileState(sessionId, filePath, state);
}

export function addComment(
  sessionId: string,
  filePath: string,
  lineId: string,
  text: string,
): void {
  const state = getFileState(sessionId, filePath);
  state.comments.push({ lineId, text, createdAt: new Date().toISOString() });
  saveFileState(sessionId, filePath, state);
}

export function deleteComment(
  sessionId: string,
  filePath: string,
  index: number,
): void {
  const state = getFileState(sessionId, filePath);
  state.comments.splice(index, 1);
  saveFileState(sessionId, filePath, state);
}
