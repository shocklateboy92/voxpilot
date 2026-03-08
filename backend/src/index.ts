import { createOpencode } from "@opencode-ai/sdk/v2";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { closeDb, getDb } from "./db";
import { createMcpRouter } from "./mcp";
import { proxy } from "./proxy";
import { createReviewRouter } from "./routes/review";
import { createConfigRouter } from "./routes/config";
import { startIdleInhibitor } from "./services/idle-inhibit";

const APP_PORT = Number(process.env.VOXPILOT_PORT ?? 8000);
const OC_PORT = Number(process.env.VOXPILOT_OC_PORT ?? 4097);

// Cache OpenCode server across hot reloads (globalThis survives Bun reloads)
const _global = globalThis as typeof globalThis & {
  __ocClient?: Awaited<ReturnType<typeof createOpencode>>["client"];
  __ocServer?: Awaited<ReturnType<typeof createOpencode>>["server"];
};

if (!_global.__ocClient) {
  const { client, server } = await createOpencode({
    hostname: "*",
    port: OC_PORT,
    config: {
      permission: "allow",
      mcp: {
        voxpilot: {
          type: "remote",
          url: `http://127.0.0.1:${APP_PORT}/mcp`,
        },
      },
    },
  });
  _global.__ocClient = client;
  _global.__ocServer = server;
  console.log(`OpenCode server started at ${server.url}`);
  void startIdleInhibitor(client);
} else {
  console.log("OpenCode server already running (hot reload), skipping restart");
}

const ocServer = _global.__ocServer as Awaited<
  ReturnType<typeof createOpencode>
>["server"];

// Initialize database (runs migrations on first call)
getDb();

const appBase = new Hono();
appBase.use("/*", cors({ origin: "*", credentials: true }));

const workDir = process.cwd();

export const app = appBase
  .route("/mcp", createMcpRouter())
  .route("/api/review", createReviewRouter(workDir))
  .route("/api/config", createConfigRouter());

// Proxy and static don't need RPC types — keep imperative
const OC_PREFIX = "/oc";
app.all(`${OC_PREFIX}/*`, proxy(ocServer.url, OC_PREFIX));
app.use("/*", serveStatic({ root: "./static" }));
app.use("/*", serveStatic({ root: "./static", path: "index.html" }));

export type AppType = typeof app;

process.on("exit", () => {
  ocServer.close();
  closeDb();
});

export default {
  port: APP_PORT,
  fetch: app.fetch,
  idleTimeout: 255,
  onListen(server: { hostname: string; port: number }) {
    console.log(`VoxPilot running on http://${server.hostname}:${server.port}`);
  },
};
