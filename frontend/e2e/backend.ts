import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";

const repo = fileURLToPath(new URL("../../", import.meta.url));

/** Read credentials from the normal service without starting or modifying it. */
export async function credentialSource() {
  const url = process.env.VOXPILOT_E2E_AUTH_SERVER;
  if (url) {
    return OpenCode.make({
      baseUrl: url,
      headers: {
        authorization: `Basic ${Buffer.from(
          `opencode:${process.env.OPENCODE_PASSWORD ?? ""}`,
        ).toString("base64")}`,
      },
    });
  }
  const endpoint = await Service.discover();
  if (!endpoint)
    throw new Error(
      "E2E needs an authenticated OpenCode service to read GitHub Copilot credentials. " +
        "Set VOXPILOT_E2E_AUTH_SERVER for an explicit credential source.",
    );
  return OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
  });
}

/** A foreground backend with disposable persistence; never attaches to a server. */
export async function startTestBackend(url: string, password: string) {
  const target = new URL(url);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  )
    throw new Error("VOXPILOT_E2E_API must be a local HTTP origin");

  const root = await mkdtemp("/tmp/opencode/voxpilot-e2e-backend-");
  const child = spawn(
    "bun",
    [fileURLToPath(new URL("./backend-process.ts", import.meta.url)), root],
    {
      cwd: repo,
      detached: true,
      // A supervisor watches stdin EOF so a crashed runner cannot orphan the DB.
      stdio: ["pipe", "ignore", "ignore", "ipc"],
      env: {
        ...process.env,
        OPENCODE_DB: join(root, "opencode.db"),
        OPENCODE_PASSWORD: password,
        VOXPILOT_PLUGIN_DIR: join(repo, "plugin"),
        VOXPILOT_HOSTNAME: target.hostname.replace(/^\[|\]$/g, ""),
        VOXPILOT_PORT: target.port || "80",
      },
    },
  );
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  let backendPID: number | undefined;
  child.on("message", (message: unknown) => {
    if (typeof message === "number") backendPID = message;
  });
  const closed = once(child, "close");
  // Handle spawn failure without an unhandled rejection before stop() runs.
  void closed.catch(() => undefined);
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    try {
      if (
        child.pid !== undefined &&
        child.exitCode === null &&
        !child.signalCode
      ) {
        child.stdin?.end();
        const timer = setTimeout(() => {
          if (
            child.pid !== undefined &&
            child.exitCode === null &&
            !child.signalCode
          )
            process.kill(-child.pid, "SIGKILL");
        }, 10_000);
        try {
          await closed;
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const client = OpenCode.make({
    baseUrl: url,
    headers: {
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    },
  });
  try {
    const deadline = Date.now() + 60_000;
    while (true) {
      if (spawnError) throw new Error("Could not launch the E2E backend");
      if (child.exitCode !== null || child.signalCode)
        throw new Error(
          "E2E backend exited during startup; check the port and plugin build",
        );
      if (Date.now() >= deadline)
        throw new Error("E2E backend startup timed out");
      const info = await client.server
        .info({ signal: AbortSignal.timeout(1_000) })
        .catch(() => undefined);
      if (info) {
        if (backendPID === undefined) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          continue;
        }
        if (info.pid !== backendPID)
          throw new Error(
            "E2E backend port is occupied; refusing to reuse an existing server",
          );
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    return { client, root, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
