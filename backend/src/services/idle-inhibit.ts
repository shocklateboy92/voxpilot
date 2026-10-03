/**
 * Desktop idle inhibition via D-Bus SimulateUserActivity.
 *
 * Subscribes to the OpenCode global event stream and pokes the
 * org.freedesktop.ScreenSaver D-Bus interface whenever an AI session
 * becomes busy or completes a message. This resets the desktop idle
 * timer so the screen won't lock/sleep mid-response, but normal idle
 * timeout resumes as soon as activity stops.
 *
 * Requires `dbus-send` on $PATH and $DBUS_SESSION_BUS_ADDRESS to be set.
 * Gracefully no-ops if either is missing or the ScreenSaver service is
 * unavailable (e.g. headless, non-KDE, CI).
 */

import { setTimeout as delay } from "node:timers/promises";
import type { OpenCodeClient } from "@opencode/client";

/** Fire-and-forget: reset the desktop idle timer. */
function simulateUserActivity(): void {
  Bun.spawn(
    [
      "dbus-send",
      "--session",
      "--dest=org.freedesktop.ScreenSaver",
      "--type=method_call",
      "/ScreenSaver",
      "org.freedesktop.ScreenSaver.SimulateUserActivity",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
}

/**
 * Probe whether dbus-send can reach the ScreenSaver service.
 * Returns true if the service responds, false otherwise.
 */
async function probeScreenSaver(signal: AbortSignal): Promise<boolean> {
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
    console.log("[idle-inhibit] $DBUS_SESSION_BUS_ADDRESS not set, disabled");
    return false;
  }

  try {
    const proc = Bun.spawn(
      [
        "dbus-send",
        "--session",
        "--dest=org.freedesktop.ScreenSaver",
        "--type=method_call",
        "--print-reply",
        "/ScreenSaver",
        "org.freedesktop.ScreenSaver.GetActive",
      ],
      { stdout: "ignore", stderr: "ignore", signal, timeout: 5_000 },
    );
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Start listening to OpenCode events and poke the idle timer on AI activity.
 *
 * Runs until cancelled; reconnects after stream failures or EOF.
 * If D-Bus isn't reachable, logs a message and returns.
 */
export async function startIdleInhibitor(
  client: OpenCodeClient,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  const available = await probeScreenSaver(signal);
  if (signal.aborted) return;
  if (!available) {
    console.log(
      "[idle-inhibit] ScreenSaver D-Bus service not reachable, disabled",
    );
    return;
  }
  console.log(
    "[idle-inhibit] ScreenSaver D-Bus service available, monitoring AI activity",
  );

  while (!signal.aborted) {
    try {
      for await (const event of client.event.subscribe({ signal })) {
        if (signal.aborted) return;
        switch (event.type) {
          case "session.status": {
            if (event.data.status.type === "busy") simulateUserActivity();
            break;
          }
          case "session.step.ended": {
            simulateUserActivity();
            break;
          }
        }
      }
    } catch {
      if (!signal.aborted)
        console.error("[idle-inhibit] Event stream failed; reconnecting");
    }
    try {
      await delay(1_000, undefined, { signal });
    } catch {
      if (signal.aborted) return;
    }
  }
}
