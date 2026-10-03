import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { closeDb, getDb } from "./db";
import { createMcpRouter } from "./mcp";
import { proxy } from "./proxy";
import { createConfigRouter } from "./routes/config";
import { createReviewRouter } from "./routes/review";
import { getOpenCode } from "./services/opencode";

// Build-time injected version. Default for source/dev runs.
declare const BUILD_VERSION: string;
const VERSION =
  typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : "0.0.0-dev";

// CLI flag handling -- early exit before any side effects.
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`VoxPilot ${VERSION}

Usage: voxpilot [options]

Options:
  -v, --version    Print version and exit
  -h, --help       Print this help and exit

Environment:
  VOXPILOT_PORT             HTTP port (default 8000)
  VOXPILOT_OC_PORT          Embedded OpenCode server port (default: auto-pick)
  VOXPILOT_OC_BINARY        Native OpenCode 2.x executable (default opencode)
  VOXPILOT_DB_PATH          SQLite database path (default voxpilot.db)
  VOXPILOT_WAKE_URL         Optional Home Assistant webhook for Wake-on-LAN

Requires the native @opencode/cli 2.x binary (https://opencode.ai/v2/docs/).`);
  process.exit(0);
}

const APP_PORT = Number(process.env.VOXPILOT_PORT ?? 8000);
// 0 = let the OS pick a free port (avoids conflicts when multiple VoxPilot
// instances run on the same machine, e.g. production service + dev process).
// The actual port is reported by the private child's JSON readiness record.
const OC_PORT = Number(process.env.VOXPILOT_OC_PORT ?? 0);

// Resolve the static assets directory. In production (compiled binary),
// the `static/` folder sits next to the binary. In development (running from
// source), it lives at backend/static (i.e. ../static relative to src/).
const staticRoot = (() => {
  const beside = resolve(dirname(process.execPath), "static");
  if (existsSync(beside)) return beside;
  return resolve(import.meta.dir, "../static");
})();

const ocServer = await getOpenCode(APP_PORT, OC_PORT);

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
app.all(
  `${OC_PREFIX}/*`,
  proxy(ocServer.url, OC_PREFIX, ocServer.authorization),
);

// Per-host PWA manifest. Chrome doesn't let users rename installed PWAs, so
// when the same VoxPilot UI is reachable via multiple hostnames (dev1.lan,
// dev2.lan, ...) the installed shortcuts all read "VoxPilot" and become
// indistinguishable. Rewrite name/short_name on the fly with the request's
// hostname (first DNS label only, e.g. "dev1") so each install gets a
// distinct label. Localhost / bare IPs get the label "dev" so a local dev
// install is also distinguishable.
app.get("/manifest.webmanifest", async (c) => {
  const file = Bun.file(resolve(staticRoot, "manifest.webmanifest"));
  const manifest = (await file.json()) as { name: string; short_name: string };
  const host = (c.req.header("host") ?? "").split(":")[0] ?? "";
  const firstLabel = host.split(".")[0] ?? "";
  const isIp = /^\d+(\.\d+){3}$/.test(host) || host.includes(":");
  const isLocal = host === "localhost" || isIp;
  const prefix = isLocal ? "dev" : firstLabel;
  if (prefix) {
    manifest.name = `${prefix} ${manifest.name}`;
    manifest.short_name = `${prefix} ${manifest.short_name}`;
  }
  return c.json(manifest, 200, {
    "content-type": "application/manifest+json",
  });
});

app.use("/*", serveStatic({ root: staticRoot }));
app.use("/*", serveStatic({ root: staticRoot, path: "index.html" }));

export type AppType = typeof app;

process.on("exit", closeDb);

// Start the HTTP server explicitly (rather than via Bun's default-export
// pattern) so we can catch bind failures -- otherwise an EADDRINUSE from a
// second VoxPilot instance can be silently swallowed by the runtime/container
// and the operator is left wondering which process is actually serving traffic.
try {
  const server = Bun.serve({
    port: APP_PORT,
    fetch: app.fetch,
    idleTimeout: 255,
    // Explicitly disable SO_REUSEPORT. Bun enables it by default, which lets
    // multiple processes bind the same port and silently load-balances
    // requests between them via the kernel -- so a second VoxPilot instance
    // would *succeed* at binding port 8000 instead of failing with
    // EADDRINUSE, leaving the operator with two backends randomly serving
    // traffic. We want hard conflicts, not silent fan-out.
    reusePort: false,
    // The compiled binary is always a production artifact; explicitly disable
    // dev mode (suppresses Bun's "Started development server" banner and the
    // contextual error pages that leak stack traces). For source/dev runs
    // (`bun --hot ...`), keep Bun's default dev-mode behavior.
    development: typeof BUILD_VERSION !== "undefined" ? false : undefined,
  });
  console.log(
    `VoxPilot ${VERSION} running on http://${server.hostname}:${server.port}`,
  );
} catch (err) {
  const code = err instanceof Error && "code" in err ? err.code : undefined;
  if (code === "EADDRINUSE") {
    console.error(
      `VoxPilot: port ${APP_PORT} is already in use. ` +
        `Another VoxPilot instance may already be running on this host. ` +
        `Set VOXPILOT_PORT to use a different port.`,
    );
  } else {
    console.error("VoxPilot: failed to start HTTP server:", err);
  }
  await ocServer.close();
  process.exit(1);
}
