import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { proxy } from "./proxy";
import { reviewRouter } from "./routes/review";

const OPENCODE_PORT = 4096;
const APP_PORT = Number(process.env.VOXPILOT_PORT ?? 8000);

const app = new Hono();
app.use("/*", cors({ origin: "*", credentials: true }));

// Review routes
app.route("/api/review", reviewRouter);

// Proxy all OpenCode API routes under /oc/*
const OC_PREFIX = "/oc";
app.all(
  `${OC_PREFIX}/*`,
  proxy(`http://127.0.0.1:${OPENCODE_PORT}`, OC_PREFIX),
);

// Static frontend
app.use("/*", serveStatic({ root: "./static" }));
app.use("/*", serveStatic({ root: "./static", path: "index.html" }));

export default {
  port: APP_PORT,
  fetch: app.fetch,
  idleTimeout: 255,
};

console.log(`VoxPilot running on http://0.0.0.0:${APP_PORT}`);
