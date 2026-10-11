import { expect, test } from "bun:test";
import type { OpenCodeEvent } from "@opencode/client";
import { shouldInhibitIdle } from "../src/services/idle";

function status(directory: string, state: "busy" | "idle"): OpenCodeEvent {
  return {
    type: "session.status",
    id: "event",
    created: 0,
    location: { directory },
    data: { sessionID: "ses_test", status: { type: state } },
  };
}

test("idle inhibition only reacts to busy activity in its own location", () => {
  expect(shouldInhibitIdle(status("/test", "busy"), "/test")).toBe(true);
  expect(shouldInhibitIdle(status("/other", "busy"), "/test")).toBe(false);
  expect(shouldInhibitIdle(status("/test", "idle"), "/test")).toBe(false);
  expect(
    shouldInhibitIdle(
      { type: "server.connected", id: "event", data: {} },
      "/test",
    ),
  ).toBe(false);
});
