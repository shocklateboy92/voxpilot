import { Hono } from "hono";

export function createConfigRouter() {
  return new Hono().get("/", (c) => {
    const wakeUrl = process.env.VOXPILOT_WAKE_URL ?? null;
    return c.json({ wakeUrl });
  });
}
