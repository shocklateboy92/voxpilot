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

import type { GlobalEvent, OpencodeClient } from "@opencode-ai/sdk/v2/client";

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
async function probeScreenSaver(): Promise<boolean> {
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
      { stdout: "pipe", stderr: "pipe" },
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
 * Call once at startup. Returns immediately; the event loop runs in the
 * background. If D-Bus isn't reachable, logs a message and returns.
 */
export async function startIdleInhibitor(
  client: OpencodeClient,
): Promise<void> {
  const available = await probeScreenSaver();
  if (!available) {
    console.log("[idle-inhibit] ScreenSaver D-Bus service not reachable, disabled");
    return;
  }
  console.log("[idle-inhibit] ScreenSaver D-Bus service available, monitoring AI activity");

  try {
    const result = await client.global.event();
    for await (const raw of result.stream) {
      const event = (raw as GlobalEvent).payload;
      if (!event) continue;

      switch (event.type) {
        case "session.status": {
          if (event.properties.status.type === "busy") {
            simulateUserActivity();
          }
          break;
        }
        case "message.updated": {
          const msg = event.properties.info;
          if (msg.role === "assistant" && "time" in msg && msg.time.completed) {
            simulateUserActivity();
          }
          break;
        }
      }
    }
  } catch (err: unknown) {
    console.error("[idle-inhibit] Event stream error:", err);
  }
}
