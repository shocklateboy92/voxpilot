import { createOpencode } from "@opencode-ai/sdk/v2";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { mcpRouter } from "./mcp";
import { proxy } from "./proxy";
import { createReviewRouter } from "./routes/review";

const APP_PORT = Number(process.env.VOXPILOT_PORT ?? 8000);
const OC_PORT = Number(process.env.VOXPILOT_OC_PORT ?? 4097);

// Start OpenCode server in-process
const { client: ocClient, server: ocServer } = await createOpencode({
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
console.log(`OpenCode server started at ${ocServer.url}`);

const app = new Hono();
app.use("/*", cors({ origin: "*", credentials: true }));

// MCP server
app.route("/mcp", mcpRouter);

// Review routes
app.route("/api/review", createReviewRouter(ocClient));

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
