/**
 * In-memory pub/sub stream registry bridging message POST and SSE stream
 * endpoints.
 *
 * Supports multiple concurrent SSE listeners per session:
 * - SessionBroadcaster: per-session message queue + event fan-out
 * - AsyncChannel<T>: multi-value producer/consumer primitive
 * - PromiseWithResolvers<boolean>: single-value confirmation futures
 *
 * Each listener receives its own AsyncChannel of BroadcastEvents so that
 * slow consumers don't block others.  Event IDs are monotonically
 * increasing per session so the client can track `Last-Event-ID`.
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

// ── Broadcast event ─────────────────────────────────────────────────────────

/** An SSE event with a monotonically increasing ID for Last-Event-ID. */
export interface BroadcastEvent {
  id: string;
  event: string;
  data: string;
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

// ── MessageHandler callback ─────────────────────────────────────────────────

/**
 * Callback invoked for each user message. The handler should process the
 * message (persist it, run the agent loop, etc.) and call
 * `broadcaster.broadcast()` to fan events out to all listeners.
 */
export type MessageHandler = (
  payload: MessagePayload,
  broadcaster: SessionBroadcaster,
) => Promise<void>;

// ── SessionBroadcaster ──────────────────────────────────────────────────────

/**
 * Per-session pub/sub broadcaster.
 *
 * - **Message queue**: single-consumer queue for incoming user messages.
 * - **Listeners**: set of per-listener event channels for fan-out.
 * - **Event IDs**: monotonically increasing counter for Last-Event-ID.
 * - **Processor**: a single async loop that reads from the message queue,
 *   invokes the provided handler, and broadcasts events.  Started lazily
 *   on the first `subscribe()` when a handler is provided.
 */
export class SessionBroadcaster {
  /** Queue for incoming user messages (single consumer — the processor). */
  readonly messageQueue = new AsyncChannel<MessagePayload | null>();

  private listeners = new Map<string, AsyncChannel<BroadcastEvent | null>>();
  private nextEventId = 1;
  private _processorRunning = false;

  // ── Listener management ───────────────────────────────────────────────

  /** Subscribe a new listener. Returns a unique ID and a personal channel. */
  subscribe(): { listenerId: string; events: AsyncChannel<BroadcastEvent | null> } {
    const listenerId = crypto.randomUUID();
    const events = new AsyncChannel<BroadcastEvent | null>();
    this.listeners.set(listenerId, events);
    return { listenerId, events };
  }

  /**
   * Unsubscribe a listener.  Sends a null sentinel to the listener's
   * channel so its relay loop exits.  If this was the last listener,
   * a null sentinel is also sent to the message queue to stop the processor.
   */
  unsubscribe(listenerId: string): void {
    const channel = this.listeners.get(listenerId);
    if (channel) {
      channel.send(null);
      this.listeners.delete(listenerId);
    }
    if (this.listeners.size === 0) {
      this.messageQueue.send(null);
    }
  }

  // ── Event broadcast ───────────────────────────────────────────────────

  /**
   * Broadcast an event to every subscribed listener.
   * Assigns a monotonically increasing event ID and returns it.
   */
  broadcast(event: string, data: string): string {
    const id = String(this.nextEventId++);
    const be: BroadcastEvent = { id, event, data };
    for (const channel of this.listeners.values()) {
      channel.send(be);
    }
    return id;
  }

  // ── Processor ─────────────────────────────────────────────────────────

  /** Whether the background message processor is currently running. */
  get processorRunning(): boolean {
    return this._processorRunning;
  }

  /** Number of currently subscribed listeners. */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Start the message processor loop.  Reads from the message queue and
   * invokes `handler` for each payload.  The handler should call
   * `broadcaster.broadcast()` to fan events to listeners.
   *
   * Only one processor runs at a time — subsequent calls are no-ops.
   * The processor exits when a null sentinel is received (triggered by
   * the last listener unsubscribing) or when no listeners remain.
   *
   * This is fire-and-forget: callers should `void broadcaster.runProcessor(…)`.
   */
  async runProcessor(handler: MessageHandler): Promise<void> {
    if (this._processorRunning) return;
    this._processorRunning = true;

    try {
      while (this.listenerCount > 0) {
        let payload: MessagePayload | null;
        try {
          payload = await this.messageQueue.receive(
            AbortSignal.timeout(30_000),
          );
        } catch {
          // Timeout — loop back and check if listeners remain
          continue;
        }

        // Null sentinel — processor shutdown
        if (payload === null) break;

        try {
          await handler(payload, this);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("Message processor error:", err);
          this.broadcast("error", JSON.stringify({ message }));
        }
      }
    } finally {
      this._processorRunning = false;
      // Notify remaining listeners that processing has stopped so their
      // relay loops exit cleanly (e.g. when a null shutdown sentinel was
      // received on the message queue).
      for (const channel of this.listeners.values()) {
        channel.send(null);
      }
    }
  }
}

// ── SessionStreamRegistry ───────────────────────────────────────────────────

export class SessionStreamRegistry {
  private sessions = new Map<string, SessionBroadcaster>();
  private pending = new Map<string, PendingConfirm>();

  // ── Session broadcaster ─────────────────────────────────────────────────

  /**
   * Get or create the broadcaster for a session.
   * Returns the broadcaster and whether it was freshly created.
   */
  getOrCreate(sessionId: string): { broadcaster: SessionBroadcaster; created: boolean } {
    const existing = this.sessions.get(sessionId);
    if (existing) return { broadcaster: existing, created: false };

    const broadcaster = new SessionBroadcaster();
    this.sessions.set(sessionId, broadcaster);
    return { broadcaster, created: true };
  }

  /**
   * Subscribe a new listener to a session's broadcaster.
   * Creates the broadcaster on first subscription.
   */
  subscribe(sessionId: string): {
    broadcaster: SessionBroadcaster;
    listenerId: string;
    events: AsyncChannel<BroadcastEvent | null>;
  } {
    const { broadcaster } = this.getOrCreate(sessionId);
    const { listenerId, events } = broadcaster.subscribe();
    return { broadcaster, listenerId, events };
  }

  /**
   * Unsubscribe a listener.  Cleans up the broadcaster from the registry
   * when the last listener unsubscribes.
   */
  unsubscribe(sessionId: string, listenerId: string): void {
    const broadcaster = this.sessions.get(sessionId);
    if (!broadcaster) return;
    broadcaster.unsubscribe(listenerId);
    if (broadcaster.listenerCount === 0) {
      this.sessions.delete(sessionId);
    }
  }

  /** Get the broadcaster for a session, or undefined. */
  get(sessionId: string): SessionBroadcaster | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Enqueue a user message on the session's message queue.
   * Returns false if no broadcaster exists (no listeners connected).
   */
  send(sessionId: string, payload: MessagePayload | null): boolean {
    const broadcaster = this.sessions.get(sessionId);
    if (!broadcaster) return false;
    broadcaster.messageQueue.send(payload);
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
