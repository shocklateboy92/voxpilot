/**
 * rAF-batched OpenCode event streaming manager.
 *
 * Bridges the OpenCode global event stream to SolidJS store with
 * requestAnimationFrame batching on the hot path (text parts).
 *
 * The SSE stream and reactive message loading are initialized at module
 * level — just importing this module activates them. Message history
 * loading is driven reactively by `activeSessionId`.
 */

import type { TextPart } from "@opencode-ai/sdk/v2/client";
import type { Event, MessageWithParts } from "./api-client";
import {
  abortSession,
  addEventListener,
  fetchMessages,
  removeEventListener,
  respondToPermission,
  sendPromptAsync,
} from "./api-client";
import type { Message } from "@opencode-ai/sdk/v2/client";
import { createEffect } from "solid-js";
import { produce } from "solid-js/store";
import {
  activeSession,
  activeSessionId,
  ensureAssistantMessage,
  extractErrorMessage,
  replaceMessages,
  selectedAgent,
  setErrorMessage,
  setMessages,
  setSessionError,
  showToast,
  mutatePermission,
  mutateQuestion,
  refetchSessions,
  upsertPart,
} from "./store";

let pendingTextPart: TextPart | null = null;
let rafId: number | null = null;
let isRafLoopRunning = false;

/**
 * Tracks part IDs that have received a full `message.part.updated` event.
 * When a full update arrives, any subsequent `message.part.delta` events for
 * that part are stale (they were in-flight before the server sent the full
 * snapshot) and should be skipped. The set is cleared on session switch.
 */
const updatedPartIds = new Set<string>();

/** Start the rAF loop that flushes pendingTextPart → store once per frame. */
function startRafLoop(): void {
  if (isRafLoopRunning) return;
  isRafLoopRunning = true;

  const tick = (): void => {
    if (!isRafLoopRunning) return;
    if (pendingTextPart) {
      upsertPart(pendingTextPart);
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

/** Stop the rAF loop. */
function stopRafLoop(): void {
  isRafLoopRunning = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/** Handle a single event from the global stream. */
function handleEvent(event: Event): void {
  if (!event) return;

  const sid = activeSessionId();

  switch (event.type) {
    case "message.updated": {
      if (!sid) return;
      const msg = event.properties.info;
      if (msg.sessionID !== sid) return;

      if (msg.role === "assistant") {
        // Assistant message started or completed
        if ("time" in msg && msg.time.completed) {
          // Message is complete — reload full messages
          const dir = activeSession()?.directory;
          void fetchMessages(sid, dir).then((msgs) => {
            // Guard against stale fetch: only replace if still on the same session
            if (activeSessionId() === sid) replaceMessages(msgs);
          });
          stopRafLoop();
          pendingTextPart = null;
          mutatePermission(null);
        } else {
          // Ensure the in-progress message exists in the store
          ensureAssistantMessage(msg.id, sid, msg);
        }
      }
      break;
    }

    case "message.part.updated": {
      if (!sid) return;
      const part = event.properties.part;
      if (part.sessionID !== sid) return;

      switch (part.type) {
        case "text": {
          if (updatedPartIds.has(part.id)) {
            // Already received a full snapshot for this part — this is a
            // later update (e.g. final content). Just upsert it directly.
            upsertPart(part);
          } else if (part.text) {
            // Non-empty text means this is a full snapshot arriving after
            // deltas were already streaming. Mark it so subsequent stale
            // deltas (still in-flight from before the snapshot) are skipped.
            updatedPartIds.add(part.id);
            upsertPart(part);
          } else {
            // Empty text — this is the initial part creation event.
            // Deltas will follow, so do NOT add to updatedPartIds.
            ensureAssistantMessage(part.messageID, sid);
            pendingTextPart = part;
            if (!isRafLoopRunning) {
              startRafLoop();
            }
          }
          break;
        }
        case "tool": {
          // Upsert tool part into the message in the store
          ensureAssistantMessage(part.messageID, sid);
          upsertPart(part);
          break;
        }
        case "step-start": {
          break;
        }
        case "step-finish": {
          break;
        }
      }
      break;
    }

    case "message.part.delta": {
      if (!sid) return;
      const { sessionID, messageID, partID, field, delta } = event.properties;
      if (sessionID !== sid) return;
      if (field !== "text") return;

      // Skip stale deltas: if we already received a full message.part.updated
      // for this part, any trailing deltas are outdated duplicates.
      if (updatedPartIds.has(partID)) return;

      // Append streamed token to the pending text part.
      // If we already have a matching pendingTextPart, just concatenate.
      // Otherwise create a minimal TextPart so the rAF loop can flush it.
      if (pendingTextPart && pendingTextPart.id === partID) {
        pendingTextPart = { ...pendingTextPart, text: pendingTextPart.text + delta };
      } else {
        ensureAssistantMessage(messageID, sid);
        pendingTextPart = {
          id: partID,
          sessionID,
          messageID,
          type: "text",
          text: delta,
        };
      }
      if (!isRafLoopRunning) {
        startRafLoop();
      }
      break;
    }

    case "permission.asked": {
      if (!sid) return;
      const perm = event.properties;
      if (perm.sessionID !== sid) return;
      mutatePermission(perm);
      break;
    }

    case "permission.replied": {
      mutatePermission(null);
      break;
    }

    case "question.asked": {
      if (!sid) return;
      const req = event.properties;
      if (req.sessionID !== sid) return;
      mutateQuestion(req);
      break;
    }

    case "question.replied":
    case "question.rejected": {
      mutateQuestion(null);
      break;
    }

    case "session.updated": {
      // Refresh session list (title may have changed)
      void refetchSessions();
      break;
    }

    case "session.error": {
      if (!sid) return;
      const props = event.properties;
      if (props.sessionID !== sid) return;
      setSessionError(true);
      const err = props.error;
      let errorMsg = "An error occurred";
      if (
        err &&
        "data" in err &&
        typeof err.data === "object" &&
        err.data !== null &&
        "message" in err.data
      ) {
        errorMsg = String((err.data as Record<string, unknown>).message);
      }
      setErrorMessage(errorMsg);
      stopRafLoop();
      break;
    }
  }
}

// ── Reactive message loading ────────────────────────────────────
// Loads/clears messages when `activeSessionId` changes.

createEffect(() => {
  const sid = activeSessionId();

  // Reset streaming state on every switch
  stopRafLoop();
  pendingTextPart = null;
  updatedPartIds.clear();
  setSessionError(false);
  setErrorMessage(null);
  mutatePermission(null);
  mutateQuestion(null);

  if (sid) {
    const dir = activeSession()?.directory;
    void fetchMessages(sid, dir).then((msgs) => {
      // Guard against rapid switches: only apply if still on this session
      if (activeSessionId() === sid) replaceMessages(msgs);
    });
  } else {
    replaceMessages([]);
  }
});

// ── Global SSE subscription ─────────────────────────────────────
// The stream starts automatically in api-client.ts; just register our handler.
// On HMR, remove the previous listener so we don't accumulate duplicates.

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    removeEventListener(handleEvent);
    stopRafLoop();
  });
}

addEventListener(handleEvent);

/**
 * Send a user message on the current session.
 * Returns true on success, false on failure.
 */
export async function sendUserMessage(content: string): Promise<boolean> {
  const sessionId = activeSessionId();
  if (!sessionId) return false;

  setErrorMessage(null);
  setSessionError(false);

  // Inject optimistic user message immediately so the UI shows it before
  // the server responds. Uses a temporary placeholder ID — the server will
  // assign the real one and reconciliation will replace it.
  const optimistic: MessageWithParts = {
    info: {
      id: "__optimistic__",
      sessionID: sessionId,
      role: "user",
      time: { created: Date.now() },
    } as Message,
    parts: [],
  };
  setMessages(produce((msgs) => { msgs.push(optimistic); }));

  try {
    const agent = selectedAgent();
    const dir = activeSession()?.directory;
    await sendPromptAsync(sessionId, content, agent, dir);
    return true;
  } catch (err: unknown) {
    // Remove the optimistic message on failure
    setMessages(produce((msgs) => {
      const idx = msgs.findIndex((m) => m.info.id === "__optimistic__");
      if (idx >= 0) msgs.splice(idx, 1);
    }));
    const msg = err instanceof Error ? err.message : "Unknown error";
    setErrorMessage(`Failed to send: ${msg}`);
    return false;
  }
}

/**
 * Abort the currently active session's generation.
 * Stops the local rAF loop immediately and requests server-side abort.
 */
export async function abortCurrentSession(): Promise<void> {
  const sessionId = activeSessionId();
  if (!sessionId) return;

  // Stop local streaming state immediately for responsive UI
  stopRafLoop();
  pendingTextPart = null;

  try {
    const dir = activeSession()?.directory;
    await abortSession(sessionId, dir);
  } catch (err: unknown) {
    showToast(`Failed to stop: ${extractErrorMessage(err)}`);
  }
}

/**
 * Respond to a pending permission request.
 */
export async function respondToConfirm(
  requestID: string,
  reply: "once" | "always" | "reject",
): Promise<void> {
  mutatePermission(null);

  try {
    const dir = activeSession()?.directory;
    await respondToPermission(requestID, reply, dir);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    setErrorMessage(`Permission error: ${msg}`);
  }
}
