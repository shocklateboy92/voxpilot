import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createOpencode } from "@opencode-ai/sdk/v2";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { closeDb, getDb } from "./db";
import { createMcpRouter } from "./mcp";
import { proxy } from "./proxy";
import { createConfigRouter } from "./routes/config";
import { createReviewRouter } from "./routes/review";
import { startIdleInhibitor } from "./services/idle-inhibit";

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
  VOXPILOT_DB_PATH          SQLite database path (default voxpilot.db)
  VOXPILOT_WAKE_URL         Optional Home Assistant webhook for Wake-on-LAN

Requires the 'opencode' binary on PATH (https://opencode.ai/docs).`);
  process.exit(0);
}

// Preflight: opencode must be on PATH. The SDK does spawn("opencode", ...)
// which would fail later with a confusing ENOENT; surface it immediately.
function checkOpencodeOnPath(): boolean {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(":").filter(Boolean);
  for (const dir of dirs) {
    const candidate = resolve(dir, "opencode");
    try {
      const st = statSync(candidate);
      // Must be a regular file (not a directory). On POSIX, we additionally
      // require it to be executable by anyone -- close enough; if it's not
      // executable by us, exec() will fail and surface a real error.
      if (st.isFile() && (st.mode & 0o111) !== 0) return true;
    } catch {
      // ENOENT or permission denied; try next dir.
    }
  }
  return false;
}

if (!checkOpencodeOnPath()) {
  console.error(
    "VoxPilot: 'opencode' binary not found on PATH.\n" +
      "  Install it from https://opencode.ai/docs (e.g. `pacman -S opencode`,\n" +
      "  `brew install anomalyco/tap/opencode`, or `curl -fsSL https://opencode.ai/install | bash`).",
  );
  process.exit(1);
}

const APP_PORT = Number(process.env.VOXPILOT_PORT ?? 8000);
// 0 = let the OS pick a free port (avoids conflicts when multiple VoxPilot
// instances run on the same machine, e.g. production service + dev process).
// The actual port is reported by the SDK via `server.url`.
const OC_PORT = Number(process.env.VOXPILOT_OC_PORT ?? 0);

// Resolve the static assets directory. In production (compiled binary),
// the `static/` folder sits next to the binary. In development (running from
// source), it lives at backend/static (i.e. ../static relative to src/).
const staticRoot = (() => {
  const beside = resolve(dirname(process.execPath), "static");
  if (existsSync(beside)) return beside;
  return resolve(import.meta.dir, "../static");
})();

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
app.use("/*", serveStatic({ root: staticRoot }));
app.use("/*", serveStatic({ root: staticRoot, path: "index.html" }));

export type AppType = typeof app;

process.on("exit", () => {
  ocServer.close();
  closeDb();
});

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
  const code =
    err instanceof Error && "code" in err ? (err as { code: unknown }).code : undefined;
  if (code === "EADDRINUSE") {
    console.error(
      `VoxPilot: port ${APP_PORT} is already in use. ` +
        `Another VoxPilot instance may already be running on this host. ` +
        `Set VOXPILOT_PORT to use a different port.`,
    );
  } else {
    console.error("VoxPilot: failed to start HTTP server:", err);
  }
  process.exit(1);
}
