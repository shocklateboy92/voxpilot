/**
 * rAF-batched OpenCode event streaming manager.
 *
 * Bridges the OpenCode global event stream to SolidJS store with
 * requestAnimationFrame batching on the hot path (text parts).
 */

import type { TextPart } from "@opencode-ai/sdk/v2/client";
import {
  fetchMessages,
  fetchPendingPermissions,
  fetchPendingQuestions,
  fetchSessionStatus,
  respondToPermission,
  sendPromptAsync,
} from "./api-client";
import type { Event } from "./sse";
import { subscribeToEvents, unsubscribeFromEvents } from "./sse";
import {
  activeSessionId,
  ensureAssistantMessage,
  replaceMessages,
  selectedAgent,
  setErrorMessage,
  setIsStreaming,
  setPendingPermission,
  setPendingQuestion,
  refetchSessions,
  upsertPart,
} from "./store";

let pendingTextPart: TextPart | null = null;
let rafId: number | null = null;
let isRafLoopRunning = false;

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

/** Active session ID tracker for filtering events. */
let currentSessionId: string | null = null;

/** Handle a single event from the global stream. */
function handleEvent(event: Event): void {
  const sid = currentSessionId;
  if (!sid) return;

  switch (event.type) {
    case "message.updated": {
      const msg = event.properties.info;
      if (msg.sessionID !== sid) return;

      if (msg.role === "assistant") {
        // Assistant message started or completed
        if ("time" in msg && msg.time.completed) {
          // Message is complete — reload full messages
          void fetchMessages(sid).then(replaceMessages);
          stopRafLoop();
          pendingTextPart = null;
          setIsStreaming(false);
          setPendingPermission(null);
        } else {
          // Ensure the in-progress message exists in the store
          ensureAssistantMessage(msg.id, sid, msg);
          setIsStreaming(true);
        }
      }
      break;
    }

    case "message.part.updated": {
      const part = event.properties.part;
      if (part.sessionID !== sid) return;

      switch (part.type) {
        case "text": {
          // Hot path: accumulate text part, rAF flushes to store
          ensureAssistantMessage(part.messageID, sid);
          pendingTextPart = part;
          if (!isRafLoopRunning) {
            startRafLoop();
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
          setIsStreaming(true);
          break;
        }
        case "step-finish": {
          break;
        }
      }
      break;
    }

    case "permission.asked": {
      const perm = event.properties;
      if (perm.sessionID !== sid) return;
      setPendingPermission(perm);
      break;
    }

    case "permission.replied": {
      setPendingPermission(null);
      break;
    }

    case "question.asked": {
      const req = event.properties;
      if (req.sessionID !== sid) return;
      setPendingQuestion(req);
      break;
    }

    case "question.replied":
    case "question.rejected": {
      setPendingQuestion(null);
      break;
    }

    case "session.updated": {
      // Refresh session list (title may have changed)
      void refetchSessions();
      break;
    }

    case "session.error": {
      const props = event.properties;
      if (props.sessionID !== sid) return;
      setIsStreaming(false);
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

/**
 * Connect to the OpenCode event stream and load session history.
 */
export function openStream(sessionId: string): void {
  closeStream();

  currentSessionId = sessionId;
  replaceMessages([]);
  setIsStreaming(false);
  setErrorMessage(null);
  setPendingPermission(null);
  setPendingQuestion(null);
  pendingTextPart = null;

  // Load existing messages
  void fetchMessages(sessionId).then(replaceMessages);

  // Subscribe to global events (do this before polling so we don't miss events)
  void subscribeToEvents(handleEvent).catch((err: unknown) => {
    if (err instanceof Error && err.name === "AbortError") return;
    const msg = err instanceof Error ? err.message : "Event stream error";
    setErrorMessage(msg);
  });

  // Poll for pending state that may have been missed (permissions, questions, session status)
  void Promise.all([
    fetchPendingPermissions().catch((err: unknown) => {
      console.warn("Failed to fetch pending permissions:", err);
      return [] as Awaited<ReturnType<typeof fetchPendingPermissions>>;
    }),
    fetchPendingQuestions().catch((err: unknown) => {
      console.warn("Failed to fetch pending questions:", err);
      return [] as Awaited<ReturnType<typeof fetchPendingQuestions>>;
    }),
    fetchSessionStatus(sessionId).catch((err: unknown) => {
      console.warn("Failed to fetch session status:", err);
      return undefined;
    }),
  ]).then(([permissions, questions, status]) => {
    // Only apply if we're still on the same session
    if (currentSessionId !== sessionId) return;

    const sessionPermission = permissions.find(
      (p) => p.sessionID === sessionId,
    );
    if (sessionPermission) {
      setPendingPermission(sessionPermission);
    }

    const sessionQuestion = questions.find((q) => q.sessionID === sessionId);
    if (sessionQuestion) {
      setPendingQuestion(sessionQuestion);
    }

    if (status?.type === "busy") {
      setIsStreaming(true);
    }
  });
}

/** Close the current event stream. */
export function closeStream(): void {
  stopRafLoop();
  currentSessionId = null;
  unsubscribeFromEvents();
}

/**
 * Send a user message on the current session.
 * Returns true on success, false on failure.
 */
export async function sendUserMessage(content: string): Promise<boolean> {
  const sessionId = activeSessionId();
  if (!sessionId) return false;

  setIsStreaming(true);
  setErrorMessage(null);

  try {
    const agent = selectedAgent();
    await sendPromptAsync(sessionId, content, agent);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    setErrorMessage(`Failed to send: ${msg}`);
    setIsStreaming(false);
    return false;
  }
}

/**
 * Respond to a pending permission request.
 */
export async function respondToConfirm(
  requestID: string,
  reply: "once" | "always" | "reject",
): Promise<void> {
  setPendingPermission(null);

  try {
    await respondToPermission(requestID, reply);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    setErrorMessage(`Permission error: ${msg}`);
  }
}
