import { createOpencode } from "@opencode-ai/sdk/v2";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { createMcpRouter } from "./mcp";
import { proxy } from "./proxy";
import { createReviewRouter } from "./routes/review";

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
} else {
  console.log("OpenCode server already running (hot reload), skipping restart");
}

const ocClient = _global.__ocClient;
const ocServer = _global.__ocServer as Awaited<
  ReturnType<typeof createOpencode>
>["server"];

const app = new Hono();
app.use("/*", cors({ origin: "*", credentials: true }));

const workDir = process.cwd();

// MCP server
app.route("/mcp", createMcpRouter(workDir));

// Review routes
app.route("/api/review", createReviewRouter(ocClient, workDir));

// Proxy all OpenCode API routes under /oc/*
const OC_PREFIX = "/oc";
app.all(`${OC_PREFIX}/*`, proxy(ocServer.url, OC_PREFIX));

// Static frontend
app.use("/*", serveStatic({ root: "./static" }));
app.use("/*", serveStatic({ root: "./static", path: "index.html" }));

export default {
  port: APP_PORT,
  fetch: app.fetch,
  idleTimeout: 255,
  onListen(server: { hostname: string; port: number }) {
    console.log(`VoxPilot running on http://${server.hostname}:${server.port}`);
  },
};
