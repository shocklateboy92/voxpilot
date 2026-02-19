import { describe, expect, it } from "bun:test";
import {
  AsyncChannel,
  SessionBroadcaster,
  SessionStreamRegistry,
  type MessagePayload,
} from "../src/services/streams";

// ── AsyncChannel ────────────────────────────────────────────────────────────

describe("AsyncChannel", () => {
  it("send then receive (buffered)", async () => {
    const ch = new AsyncChannel<number>();
    ch.send(1);
    ch.send(2);
    expect(await ch.receive()).toBe(1);
    expect(await ch.receive()).toBe(2);
  });

  it("receive then send (waiting)", async () => {
    const ch = new AsyncChannel<string>();
    const p = ch.receive();
    ch.send("hello");
    expect(await p).toBe("hello");
  });

  it("receive rejects on abort signal", async () => {
    const ch = new AsyncChannel<number>();
    const controller = new AbortController();
    const p = ch.receive(controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(p).rejects.toThrow("cancelled");
  });

  it("receive with timeout via AbortSignal.timeout", async () => {
    const ch = new AsyncChannel<number>();
    const p = ch.receive(AbortSignal.timeout(10));
    await expect(p).rejects.toThrow();
  });

  it("buffered value takes priority over waiting", async () => {
    const ch = new AsyncChannel<number>();
    ch.send(42);
    const result = await ch.receive();
    expect(result).toBe(42);
  });

  it("multiple waiters are resolved in order", async () => {
    const ch = new AsyncChannel<number>();
    const p1 = ch.receive();
    const p2 = ch.receive();
    ch.send(1);
    ch.send(2);
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
  });
});

// ── SessionBroadcaster ──────────────────────────────────────────────────────

describe("SessionBroadcaster", () => {
  it("subscribe returns unique listener IDs", () => {
    const bc = new SessionBroadcaster();
    const l1 = bc.subscribe();
    const l2 = bc.subscribe();
    expect(l1.listenerId).not.toBe(l2.listenerId);
    expect(bc.listenerCount).toBe(2);
  });

  it("broadcast sends to all listeners", async () => {
    const bc = new SessionBroadcaster();
    const l1 = bc.subscribe();
    const l2 = bc.subscribe();

    bc.broadcast("text-delta", '{"content":"hi"}');

    const e1 = await l1.events.receive();
    const e2 = await l2.events.receive();
    expect(e1).not.toBeNull();
    expect(e2).not.toBeNull();
    expect(e1?.event).toBe("text-delta");
    expect(e2?.event).toBe("text-delta");
    expect(e1?.data).toBe('{"content":"hi"}');
    expect(e2?.data).toBe('{"content":"hi"}');
  });

  it("broadcast assigns monotonically increasing IDs", () => {
    const bc = new SessionBroadcaster();
    bc.subscribe();
    const id1 = bc.broadcast("a", "{}");
    const id2 = bc.broadcast("b", "{}");
    const id3 = bc.broadcast("c", "{}");
    expect(Number(id1)).toBeLessThan(Number(id2));
    expect(Number(id2)).toBeLessThan(Number(id3));
  });

  it("unsubscribe sends null sentinel to the listener", async () => {
    const bc = new SessionBroadcaster();
    const l1 = bc.subscribe();
    bc.unsubscribe(l1.listenerId);
    const event = await l1.events.receive();
    expect(event).toBeNull();
  });

  it("unsubscribe sends null to message queue when last listener leaves", async () => {
    const bc = new SessionBroadcaster();
    const l1 = bc.subscribe();
    bc.unsubscribe(l1.listenerId);
    // The message queue should have received a null sentinel
    const payload = await bc.messageQueue.receive();
    expect(payload).toBeNull();
  });

  it("unsubscribe does NOT send null to message queue while listeners remain", () => {
    const bc = new SessionBroadcaster();
    const l1 = bc.subscribe();
    bc.subscribe(); // l2
    bc.unsubscribe(l1.listenerId);
    expect(bc.listenerCount).toBe(1);
    // No null sentinel should be on the message queue — nothing to receive
  });

  it("broadcast does not reach unsubscribed listeners", async () => {
    const bc = new SessionBroadcaster();
    const l1 = bc.subscribe();
    const l2 = bc.subscribe();
    bc.unsubscribe(l1.listenerId);

    bc.broadcast("msg", "{}");

    // l1 received a null sentinel (from unsubscribe), not the broadcast
    const e1 = await l1.events.receive();
    expect(e1).toBeNull();

    // l2 should receive the broadcast
    const e2 = await l2.events.receive();
    expect(e2?.event).toBe("msg");
  });

  it("runProcessor invokes handler for each message", async () => {
    const bc = new SessionBroadcaster();
    const l1 = bc.subscribe();

    const handled: string[] = [];
    const processorDone = bc.runProcessor(async (payload, broadcaster) => {
      handled.push(payload.content);
      broadcaster.broadcast("echo", JSON.stringify({ content: payload.content }));
    });

    bc.messageQueue.send({ content: "one", model: "m", gh_token: "t" });
    bc.messageQueue.send({ content: "two", model: "m", gh_token: "t" });

    // Wait for events to arrive
    const e1 = await l1.events.receive(AbortSignal.timeout(1000));
    const e2 = await l1.events.receive(AbortSignal.timeout(1000));
    expect(e1?.event).toBe("echo");
    expect(e2?.event).toBe("echo");

    // Shut down processor
    bc.unsubscribe(l1.listenerId);
    await processorDone;

    expect(handled).toEqual(["one", "two"]);
  });

  it("runProcessor broadcasts error on handler exception", async () => {
    const bc = new SessionBroadcaster();
    const l1 = bc.subscribe();

    const processorDone = bc.runProcessor(async () => {
      throw new Error("boom");
    });

    bc.messageQueue.send({ content: "x", model: "m", gh_token: "t" });

    const event = await l1.events.receive(AbortSignal.timeout(1000));
    expect(event?.event).toBe("error");
    expect(JSON.parse(event?.data ?? "{}").message).toContain("boom");

    bc.unsubscribe(l1.listenerId);
    await processorDone;
  });

  it("runProcessor is no-op when already running", async () => {
    const bc = new SessionBroadcaster();
    bc.subscribe();

    let callCount = 0;
    void bc.runProcessor(async () => {
      callCount++;
    });

    // Second call should be a no-op
    void bc.runProcessor(async () => {
      callCount += 100;
    });

    bc.messageQueue.send({ content: "hi", model: "m", gh_token: "t" });
    await sleep(50);

    // Only the first processor should have run
    expect(callCount).toBe(1);

    // Clean up
    bc.messageQueue.send(null);
    await sleep(10);
  });
});

// ── SessionStreamRegistry ───────────────────────────────────────────────────

describe("SessionStreamRegistry", () => {
  it("subscribe creates broadcaster on first call", () => {
    const reg = new SessionStreamRegistry();
    const { broadcaster, listenerId } = reg.subscribe("s1");
    expect(broadcaster).toBeDefined();
    expect(listenerId).toBeDefined();
    expect(reg.get("s1")).toBe(broadcaster);
  });

  it("subscribe reuses existing broadcaster", () => {
    const reg = new SessionStreamRegistry();
    const r1 = reg.subscribe("s1");
    const r2 = reg.subscribe("s1");
    expect(r1.broadcaster).toBe(r2.broadcaster);
    expect(r1.listenerId).not.toBe(r2.listenerId);
  });

  it("send returns true when broadcaster exists", () => {
    const reg = new SessionStreamRegistry();
    reg.subscribe("s1");
    const payload: MessagePayload = { content: "hi", model: "gpt-4o", gh_token: "tok" };
    expect(reg.send("s1", payload)).toBe(true);
  });

  it("send returns false for unknown session", () => {
    const reg = new SessionStreamRegistry();
    expect(reg.send("nope", null)).toBe(false);
  });

  it("get returns undefined for unknown session", () => {
    const reg = new SessionStreamRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });

  it("unsubscribe removes broadcaster when last listener leaves", () => {
    const reg = new SessionStreamRegistry();
    const { listenerId } = reg.subscribe("s1");
    reg.unsubscribe("s1", listenerId);
    expect(reg.get("s1")).toBeUndefined();
  });

  it("unsubscribe keeps broadcaster while listeners remain", () => {
    const reg = new SessionStreamRegistry();
    const r1 = reg.subscribe("s1");
    reg.subscribe("s1");
    reg.unsubscribe("s1", r1.listenerId);
    expect(reg.get("s1")).toBeDefined();
  });

  it("multiple listeners receive broadcast events", async () => {
    const reg = new SessionStreamRegistry();
    const r1 = reg.subscribe("s1");
    const r2 = reg.subscribe("s1");

    r1.broadcaster.broadcast("msg", "{}");

    const e1 = await r1.events.receive();
    const e2 = await r2.events.receive();
    expect(e1?.event).toBe("msg");
    expect(e2?.event).toBe("msg");
  });

  it("send enqueues on broadcaster message queue", async () => {
    const reg = new SessionStreamRegistry();
    const { broadcaster } = reg.subscribe("s1");
    const payload: MessagePayload = { content: "hi", model: "gpt-4o", gh_token: "tok" };
    reg.send("s1", payload);
    const received = await broadcaster.messageQueue.receive(AbortSignal.timeout(100));
    expect(received).toEqual(payload);
  });
});

// ── SessionStreamRegistry — confirmation ────────────────────────────────────

describe("SessionStreamRegistry confirmation", () => {
  it("awaitConfirmation and resolveConfirmation (approved)", async () => {
    const reg = new SessionStreamRegistry();
    const p = reg.awaitConfirmation("s1", "call_1");
    const ok = reg.resolveConfirmation("s1", "call_1", true);
    expect(ok).toBe(true);
    expect(await p).toBe(true);
  });

  it("awaitConfirmation and resolveConfirmation (denied)", async () => {
    const reg = new SessionStreamRegistry();
    const p = reg.awaitConfirmation("s1", "call_1");
    const ok = reg.resolveConfirmation("s1", "call_1", false);
    expect(ok).toBe(true);
    expect(await p).toBe(false);
  });

  it("resolveConfirmation fails with mismatched id", () => {
    const reg = new SessionStreamRegistry();
    reg.awaitConfirmation("s1", "call_1");
    expect(reg.resolveConfirmation("s1", "call_WRONG", true)).toBe(false);
  });

  it("resolveConfirmation fails with no pending", () => {
    const reg = new SessionStreamRegistry();
    expect(reg.resolveConfirmation("s1", "call_1", true)).toBe(false);
  });

  it("resolveConfirmation clears pending after success", async () => {
    const reg = new SessionStreamRegistry();
    const p = reg.awaitConfirmation("s1", "call_1");
    reg.resolveConfirmation("s1", "call_1", true);
    await p;
    expect(reg.resolveConfirmation("s1", "call_1", true)).toBe(false);
  });

  it("hasPendingConfirm tracks state", () => {
    const reg = new SessionStreamRegistry();
    expect(reg.hasPendingConfirm("s1")).toBe(false);
    reg.awaitConfirmation("s1", "call_1");
    expect(reg.hasPendingConfirm("s1")).toBe(true);
    reg.resolveConfirmation("s1", "call_1", true);
    expect(reg.hasPendingConfirm("s1")).toBe(false);
  });

  it("getPendingToolCallId returns correct id", () => {
    const reg = new SessionStreamRegistry();
    expect(reg.getPendingToolCallId("s1")).toBeUndefined();
    reg.awaitConfirmation("s1", "call_1");
    expect(reg.getPendingToolCallId("s1")).toBe("call_1");
  });

  it("abort signal resolves as false (denial)", async () => {
    const reg = new SessionStreamRegistry();
    const controller = new AbortController();
    const p = reg.awaitConfirmation("s1", "call_1", controller.signal);
    controller.abort();
    expect(await p).toBe(false);
    expect(reg.hasPendingConfirm("s1")).toBe(false);
  });

  it("timeout resolves as false", async () => {
    const reg = new SessionStreamRegistry();
    const p = reg.awaitConfirmation("s1", "call_1", AbortSignal.timeout(10));
    expect(await p).toBe(false);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
