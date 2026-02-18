/**
 * SSE streaming client for session-scoped event streams.
 *
 * Uses browser-native EventSource for GET /api/sessions/{id}/stream.
 * All event payloads are JSON.
 *
 * Event types:
 *   message     → onMessage(payload)    — history replay + echoed user messages
 *   ready       → onReady()             — end of history replay
 *   text-delta  → onTextDelta(content)  — streamed assistant token
 *   done        → onDone(model)         — assistant response complete
 *   error       → onError(message)      — something went wrong
 */

// ── SSE event payload types (mirror backend schemas) ────────────────────────

export interface MessagePayload {
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface TextDeltaPayload {
  content: string;
}

export interface DonePayload {
  model: string;
}

export interface ErrorPayload {
  message: string;
}

export interface SessionStreamCallbacks {
  onMessage: (payload: MessagePayload) => void;
  onReady: () => void;
  onTextDelta: (content: string) => void;
  onDone: (model: string) => void;
  onError: (message: string) => void;
}

/**
 * Connect to a session's SSE stream.
 *
 * Returns the EventSource instance so the caller can close it
 * (e.g., on session switch).  The stream replays all existing
 * messages as `message` events, then signals `ready`, then
 * delivers live events as messages are posted.
 */
export function connectSession(
  sessionId: string,
  callbacks: SessionStreamCallbacks,
): EventSource {
  const url = `/api/sessions/${sessionId}/stream`;
  const es = new EventSource(url, { withCredentials: true });

  es.addEventListener("message", (e: MessageEvent) => {
    try {
      const payload = JSON.parse(e.data) as MessagePayload;
      callbacks.onMessage(payload);
    } catch {
      callbacks.onError(`Failed to parse message event: ${e.data}`);
    }
  });

  es.addEventListener("ready", () => {
    callbacks.onReady();
  });

  es.addEventListener("text-delta", (e: MessageEvent) => {
    try {
      const payload = JSON.parse(e.data) as TextDeltaPayload;
      callbacks.onTextDelta(payload.content);
    } catch {
      callbacks.onError(`Failed to parse text-delta event: ${e.data}`);
    }
  });

  es.addEventListener("done", (e: MessageEvent) => {
    try {
      const payload = JSON.parse(e.data) as DonePayload;
      callbacks.onDone(payload.model);
    } catch {
      callbacks.onError(`Failed to parse done event: ${e.data}`);
    }
  });

  es.addEventListener("error", (e: MessageEvent) => {
    // EventSource fires a generic error event on connection loss
    // (with no `data`).  Only dispatch to onError when we have a
    // server-sent payload; otherwise let EventSource reconnect.
    if (e.data) {
      try {
        const payload = JSON.parse(e.data) as ErrorPayload;
        callbacks.onError(payload.message);
      } catch {
        callbacks.onError(`Failed to parse error event: ${e.data}`);
      }
    }
  });

  return es;
}

/**
 * Post a user message to an active session stream.
 *
 * Returns the fetch Response (202 on success, 409 if no stream).
 */
export async function sendMessage(
  sessionId: string,
  content: string,
  model: string = "gpt-4o",
): Promise<Response> {
  const response = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ content, model }),
  });

  if (response.status === 401) {
    window.location.reload();
  }

  return response;
}
