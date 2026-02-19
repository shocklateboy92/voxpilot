/**
 * In-memory stream registry bridging message POST and SSE stream endpoints.
 *
 * Replaces the Python version that used asyncio.Queue / asyncio.Event with:
 * - AsyncChannel<T> for multi-value producer/consumer (message delivery)
 * - PromiseWithResolvers<boolean> for single-value confirmation futures
 */

// ── AsyncChannel ────────────────────────────────────────────────────────────

export class AsyncChannel<T> {
  private buffer: T[] = [];
  private waiters: PromiseWithResolvers<T>[] = [];

  /** Non-blocking send — resolves a waiting receiver or buffers. */
  send(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(value);
    } else {
      this.buffer.push(value);
    }
  }

  /** Await the next value. Pass an AbortSignal for timeout/cancellation. */
  async receive(signal?: AbortSignal): Promise<T> {
    const buffered = this.buffer.shift();
    if (buffered !== undefined) return buffered;

    const deferred = Promise.withResolvers<T>();
    this.waiters.push(deferred);

    if (signal) {
      const onAbort = () => {
        const idx = this.waiters.indexOf(deferred);
        if (idx >= 0) this.waiters.splice(idx, 1);
        deferred.reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      return deferred.promise.finally(() =>
        signal.removeEventListener("abort", onAbort),
      );
    }

    return deferred.promise;
  }
}

// ── Confirmation ────────────────────────────────────────────────────────────

interface PendingConfirm {
  toolCallId: string;
  deferred: PromiseWithResolvers<boolean>;
}

// ── Payload type for message queue ──────────────────────────────────────────

export interface MessagePayload {
  content: string;
  model: string;
  gh_token: string;
}

// ── SessionStreamRegistry ───────────────────────────────────────────────────

export class SessionStreamRegistry {
  private channels = new Map<string, AsyncChannel<MessagePayload | null>>();
  private pending = new Map<string, PendingConfirm>();

  // ── Message channel ─────────────────────────────────────────────────────

  /** Create and register a channel for the session, returning it. */
  register(sessionId: string): AsyncChannel<MessagePayload | null> {
    const channel = new AsyncChannel<MessagePayload | null>();
    this.channels.set(sessionId, channel);
    return channel;
  }

  /** Remove the channel for the session (no-op if not registered). */
  unregister(sessionId: string): void {
    this.channels.delete(sessionId);
  }

  /** Return the channel for the session, or undefined. */
  get(sessionId: string): AsyncChannel<MessagePayload | null> | undefined {
    return this.channels.get(sessionId);
  }

  /** Put a payload on the session's channel. Returns false if no channel. */
  send(sessionId: string, payload: MessagePayload | null): boolean {
    const channel = this.channels.get(sessionId);
    if (!channel) return false;
    channel.send(payload);
    return true;
  }

  // ── Confirmation ────────────────────────────────────────────────────────

  /**
   * Await a user confirmation for a tool call.
   * Pass an AbortSignal to enforce a timeout — abort resolves as `false` (denial).
   */
  awaitConfirmation(
    sessionId: string,
    toolCallId: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const deferred = Promise.withResolvers<boolean>();
    this.pending.set(sessionId, { toolCallId, deferred });

    if (signal) {
      const onAbort = () => {
        this.pending.delete(sessionId);
        deferred.resolve(false); // timeout/cancel → denial
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    return deferred.promise;
  }

  /**
   * Resolve a pending confirmation. Returns false if no confirmation is
   * pending or the toolCallId doesn't match.
   */
  resolveConfirmation(
    sessionId: string,
    toolCallId: string,
    approved: boolean,
  ): boolean {
    const entry = this.pending.get(sessionId);
    if (!entry || entry.toolCallId !== toolCallId) return false;
    this.pending.delete(sessionId);
    entry.deferred.resolve(approved);
    return true;
  }

  /** Check whether a confirmation is pending for the session. */
  hasPendingConfirm(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  /** Get the pending tool call ID for a session, if any. */
  getPendingToolCallId(sessionId: string): string | undefined {
    return this.pending.get(sessionId)?.toolCallId;
  }
}

/** Global singleton registry. */
export const registry = new SessionStreamRegistry();
