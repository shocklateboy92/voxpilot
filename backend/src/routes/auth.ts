import { Hono } from "hono";
import {
  pollDeviceFlow,
  startDeviceFlow,
  tokenManager,
} from "../services/copilot-auth";

// Single-user: one pending device flow at a time.
// Concurrent device flow requests will overwrite each other — this is intentional
// for a single-user server where only one person is authenticating at a time.
let pendingDeviceCode: string | null = null;
let pendingInterval = 5;

export const authRouter = new Hono()
  .post("/api/auth/device", async (c) => {
    try {
      const flow = await startDeviceFlow();
      pendingDeviceCode = flow.device_code;
      pendingInterval = flow.interval;
      return c.json({
        user_code: flow.user_code,
        verification_uri: flow.verification_uri,
        interval: flow.interval,
      });
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : "Failed to start device flow";
      return c.json({ detail }, 400);
    }
  })
  .get("/api/auth/device/poll", async (c) => {
    if (!pendingDeviceCode) {
      return c.json({ status: "error", detail: "No pending device flow" }, 400);
    }

    const result = await pollDeviceFlow(pendingDeviceCode, pendingInterval);

    if (result.status === "success") {
      pendingDeviceCode = null;
      try {
        await tokenManager.authenticate(result.access_token);
        return c.json({ status: "ok" });
      } catch (err) {
        const detail =
          err instanceof Error ? err.message : "Authentication failed";
        return c.json({ status: "error", detail }, 500);
      }
    }

    if (result.status === "slow_down") {
      pendingInterval = result.interval;
      return c.json({ status: "pending" });
    }

    if (result.status === "pending") {
      return c.json({ status: "pending" });
    }

    if (result.status === "expired") {
      pendingDeviceCode = null;
      return c.json({ status: "error", detail: "Device code expired" });
    }

    return c.json({ status: "error", detail: result.detail });
  })
  .get("/api/auth/me", (c) => {
    if (!tokenManager.isAuthenticated()) {
      return c.json({ detail: "Not authenticated" }, 401);
    }
    const user = tokenManager.getUser();
    return c.json(user);
  })
  .post("/api/auth/logout", async (c) => {
    await tokenManager.logout();
    return c.json({ status: "ok" });
  });
