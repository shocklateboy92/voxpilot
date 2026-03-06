/**
 * rAF-batched OpenCode event streaming manager.
 *
 * Bridges the OpenCode global event stream to SolidJS store with
 * requestAnimationFrame batching on the hot path (text parts).
 *
 * Call `startStreaming()` after the store is populated (from App.tsx)
 * to register the SSE listener and activate reactive message loading.
 */

import type { TextPart } from "@opencode-ai/sdk/v2/client";
import type { Event, MessageWithParts } from "./api-client";
import {
  abortSession,
  addEventListener,
  fetchGitBranch,
  fetchMessages,
  removeEventListener,
  respondToPermission,
  sendPromptAsync,
} from "./api-client";
import type { Message } from "@opencode-ai/sdk/v2/client";
import { createEffect } from "solid-js";
import { produce } from "solid-js/store";
import {
  ensureAssistantMessage,
  replaceMessages,
  setStore,
  upsertPart,
} from "./store";
import { activeSession, activeSessionId } from "./navigation";
import { selectedAgent } from "./preferences";
import { extractErrorMessage, showToast } from "./toast";

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
        if ("time" in msg && msg.time.completed) {
          // Message is complete — reload full messages
          const dir = activeSession()?.directory;
          void fetchMessages(sid, dir).then((msgs) => {
            if (activeSessionId() === sid) replaceMessages(msgs);
          });
          stopRafLoop();
          pendingTextPart = null;
        } else {
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
            upsertPart(part);
          } else if (part.text) {
            updatedPartIds.add(part.id);
            upsertPart(part);
          } else {
            ensureAssistantMessage(part.messageID, sid);
            pendingTextPart = part;
            if (!isRafLoopRunning) {
              startRafLoop();
            }
          }
          break;
        }
        case "tool": {
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

      if (updatedPartIds.has(partID)) return;

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

    // ── Cross-session event handlers ────────────────────────────

    case "session.status": {
      const { sessionID, status } = event.properties;
      setStore("sessionStatuses", sessionID, status);
      if (status.type === "busy") {
        setStore("sessionErrors", produce((draft) => { delete draft[sessionID]; }));
      }
      break;
    }

    case "session.created": {
      const info = event.properties.info;
      setStore("sessions", produce((list) => {
        if (list.some((s) => s.id === info.id)) return; // already exists (optimistic)
        list.push(info);
        list.sort((a, b) => b.time.updated - a.time.updated);
      }));
      break;
    }

    case "session.deleted": {
      const info = event.properties.info;
      setStore("sessions", (prev) => prev.filter((s) => s.id !== info.id));
      setStore("sessionStatuses", produce((draft) => { delete draft[info.id]; }));
      setStore("sessionPermissions", produce((draft) => { delete draft[info.id]; }));
      setStore("sessionQuestions", produce((draft) => { delete draft[info.id]; }));
      setStore("sessionErrors", produce((draft) => { delete draft[info.id]; }));
      break;
    }

    case "session.updated": {
      const info = event.properties.info;
      if (info.time.archived) {
        setStore("sessions", (prev) => prev.filter((s) => s.id !== info.id));
      } else {
        setStore("sessions", produce((list) => {
          const idx = list.findIndex((s) => s.id === info.id);
          if (idx >= 0) list[idx] = info;
          else list.push(info);
          list.sort((a, b) => b.time.updated - a.time.updated);
        }));
      }
      break;
    }

    case "session.error": {
      const props = event.properties;
      const errorSessionID = props.sessionID as string;
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
      // Store for all sessions (cross-session tracking)
      setStore("sessionErrors", errorSessionID, errorMsg);
      // Active session UI state
      if (errorSessionID !== sid) break;
      setStore("sessionError", true);
      setStore("errorMessage", errorMsg);
      stopRafLoop();
      break;
    }

    case "permission.asked": {
      const perm = event.properties;
      setStore("sessionPermissions", perm.sessionID, perm);
      break;
    }

    case "permission.replied": {
      const props = event.properties;
      setStore("sessionPermissions", produce((draft) => { delete draft[props.sessionID]; }));
      break;
    }

    case "question.asked": {
      const req = event.properties;
      setStore("sessionQuestions", req.sessionID, req);
      break;
    }

    case "question.replied":
    case "question.rejected": {
      const props = event.properties;
      setStore("sessionQuestions", produce((draft) => { delete draft[props.sessionID]; }));
      break;
    }

    case "vcs.branch.updated": {
      const activeDir = activeSession()?.directory;
      const props = event.properties as { directory?: string; branch?: string };
      if (activeDir && props.directory === activeDir) {
        setStore("gitBranch", props.branch ?? null);
      }
      break;
    }
  }
}

// ── Reactive message loading + SSE subscription ────────────────
// Activated by startStreaming() after the store is populated.

export function startStreaming(): void {
  // Loads/clears messages when `activeSessionId` changes.
  createEffect(() => {
    const sid = activeSessionId();

    // Reset streaming state on every switch
    stopRafLoop();
    pendingTextPart = null;
    updatedPartIds.clear();
    setStore("sessionError", false);
    setStore("errorMessage", null);

    if (sid) {
      const dir = activeSession()?.directory;
      void fetchMessages(sid, dir).then((msgs) => {
        if (activeSessionId() === sid) replaceMessages(msgs);
      });
      // Fetch git branch for the new session's directory
      void fetchGitBranch(dir).then((branch) => {
        if (activeSessionId() === sid) {
          setStore("gitBranch", branch);
        }
      });
    } else {
      replaceMessages([]);
      setStore("gitBranch", null);
    }
  });

  // Global SSE subscription
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      removeEventListener(handleEvent);
      stopRafLoop();
    });
  }

  addEventListener(handleEvent);
}

// ── Exported action functions ───────────────────────────────────

/**
 * Send a user message on the current session.
 * Returns true on success, false on failure.
 */
export async function sendUserMessage(content: string): Promise<boolean> {
  const sessionId = activeSessionId();
  if (!sessionId) return false;

  setStore("errorMessage", null);
  setStore("sessionError", false);

  // Inject optimistic user message
  const optimistic: MessageWithParts = {
    info: {
      id: "__optimistic__",
      sessionID: sessionId,
      role: "user",
      time: { created: Date.now() },
    } as Message,
    parts: [],
  };
  setStore("messages", produce((msgs) => { msgs.push(optimistic); }));

  try {
    const agent = selectedAgent();
    const dir = activeSession()?.directory;
    await sendPromptAsync(sessionId, content, agent, dir);
    return true;
  } catch (err: unknown) {
    // Remove the optimistic message on failure
    setStore("messages", produce((msgs) => {
      const idx = msgs.findIndex((m) => m.info.id === "__optimistic__");
      if (idx >= 0) msgs.splice(idx, 1);
    }));
    const msg = err instanceof Error ? err.message : "Unknown error";
    setStore("errorMessage", `Failed to send: ${msg}`);
    return false;
  }
}

/**
 * Abort the currently active session's generation.
 */
export async function abortCurrentSession(): Promise<void> {
  const sessionId = activeSessionId();
  if (!sessionId) return;

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
  const sid = activeSessionId();
  if (sid) {
    setStore("sessionPermissions", produce((draft) => { delete draft[sid]; }));
  }

  try {
    const dir = activeSession()?.directory;
    await respondToPermission(requestID, reply, dir);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    setStore("errorMessage", `Permission error: ${msg}`);
  }
}
