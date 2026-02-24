import { createOpencode } from "@opencode-ai/sdk";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { proxy } from "./proxy";
import { reviewRouter } from "./routes/review";

const APP_PORT = Number(process.env.VOXPILOT_PORT ?? 8000);

// Start OpenCode server in-process
const { server: ocServer } = await createOpencode();
console.log(`OpenCode server started at ${ocServer.url}`);

const app = new Hono();
app.use("/*", cors({ origin: "*", credentials: true }));

// Review routes
app.route("/api/review", reviewRouter);

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
};

console.log(`VoxPilot running on http://0.0.0.0:${APP_PORT}`);
