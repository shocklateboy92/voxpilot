import { describe, expect, it } from "bun:test";
import {
  AsyncChannel,
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
    // Even though there is no waiting receiver, it lands in the buffer
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

// ── SessionStreamRegistry — message channel ─────────────────────────────────

describe("SessionStreamRegistry", () => {
  it("register and send/receive", async () => {
    const reg = new SessionStreamRegistry();
    const channel = reg.register("s1");
    const payload: MessagePayload = {
      content: "hi",
      model: "gpt-4o",
      gh_token: "tok",
    };
    reg.send("s1", payload);
    const received = await channel.receive();
    expect(received).toEqual(payload);
  });

  it("send returns false for unregistered session", () => {
    const reg = new SessionStreamRegistry();
    expect(reg.send("nope", null)).toBe(false);
  });

  it("get returns undefined for unregistered session", () => {
    const reg = new SessionStreamRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });

  it("unregister removes the channel", () => {
    const reg = new SessionStreamRegistry();
    reg.register("s1");
    reg.unregister("s1");
    expect(reg.get("s1")).toBeUndefined();
    expect(reg.send("s1", null)).toBe(false);
  });

  it("register replaces existing channel", async () => {
    const reg = new SessionStreamRegistry();
    const ch1 = reg.register("s1");
    const ch2 = reg.register("s1");
    expect(ch1).not.toBe(ch2);
    // New channel should be the active one
    expect(reg.get("s1")).toBe(ch2);
  });

  it("sends null sentinel", async () => {
    const reg = new SessionStreamRegistry();
    const ch = reg.register("s1");
    reg.send("s1", null);
    expect(await ch.receive()).toBeNull();
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
    // Second resolve with same ID should fail
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
