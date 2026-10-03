import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  type ConfigEntry,
  OpenCode,
  type OpenCodeClient,
} from "@opencode/client";
import { startIdleInhibitor } from "./idle-inhibit";

declare global {
  var __voxpilotOwnedOpenCode:
    | Promise<Awaited<ReturnType<typeof startOpenCode>>>
    | undefined;
}

type OwnedOpenCode = {
  client: OpenCodeClient;
  url: string;
  authorization: string;
  close: () => Promise<void>;
};

export function getOpenCode(
  appPort: number,
  port: number,
): Promise<OwnedOpenCode> {
  if (globalThis.__voxpilotOwnedOpenCode)
    return globalThis.__voxpilotOwnedOpenCode;
  function clearCache() {
    if (globalThis.__voxpilotOwnedOpenCode === pending)
      globalThis.__voxpilotOwnedOpenCode = undefined;
  }
  const pending = startOpenCode(appPort, port, clearCache).catch(
    (error: unknown) => {
      clearCache();
      throw error;
    },
  );
  globalThis.__voxpilotOwnedOpenCode = pending;
  return pending;
}

async function startOpenCode(
  appPort: number,
  port: number,
  clearCache: () => void,
): Promise<OwnedOpenCode> {
  const binary = "opencode";
  const install = "Install the native @opencode/cli 2.x binary on PATH.";
  const version = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (version.error || version.status !== 0) {
    throw new Error(
      `VoxPilot: could not run '${binary} --version'. ${install}`,
    );
  }
  const detected = version.stdout
    .trim()
    .match(/(?:^|\s)v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\s|$)/)?.[1];
  if (!detected?.startsWith("2.")) {
    throw new Error(
      `VoxPilot: OpenCode 2.x is required; detected ${detected ?? "an unrecognized version"}. OpenCode 1.x is incompatible. ${install}`,
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      "VoxPilot: VOXPILOT_OC_PORT must be an integer between 0 and 65535.",
    );
  }

  const password = process.env.VOXPILOT_OC_PASSWORD ?? "abc123";
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const config = {
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    mcp: {
      servers: {
        voxpilot: {
          type: "remote",
          url: `http://127.0.0.1:${appPort}/mcp`,
          codemode: false,
        },
      },
    },
  } satisfies Extract<ConfigEntry, { type: "document" }>["info"];
  const child = spawn(
    binary,
    ["serve", "--stdio", "--hostname", "0.0.0.0", "--port", String(port)],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        OPENCODE_PASSWORD: password,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      },
    },
  );
  // Drain diagnostics without ever logging credentials or inherited configuration.
  child.stderr.resume();
  child.stdin.on("error", () => {}); // The lease can close when startup fails.
  const controller = new AbortController();
  let stopped = false;
  let exited = false;
  let termination: ReturnType<typeof setTimeout> | undefined;
  let kill: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    const finish = () => {
      if (exited) return;
      exited = true;
      controller.abort();
      clearTimeout(termination);
      clearTimeout(kill);
      process.off("exit", onExit);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
      clearCache();
      resolve();
    };
    child.once("exit", finish);
    child.once("error", finish);
  });

  function close() {
    if (!stopped && !exited) {
      stopped = true;
      controller.abort();
      // Closing stdin releases only this private server's ownership lease.
      child.stdin.end();
      termination = setTimeout(() => child.kill("SIGTERM"), 1_000);
      kill = setTimeout(() => child.kill("SIGKILL"), 5_000);
      termination.unref();
      kill.unref();
    }
    return done;
  }
  function onExit() {
    controller.abort();
    child.stdin.end();
    if (!exited) child.kill("SIGTERM");
  }
  function onInterrupt() {
    void close().then(() => process.exit(130));
  }
  function onTerminate() {
    void close().then(() => process.exit(143));
  }
  process.once("exit", onExit);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);

  const lines = createInterface({ input: child.stdout });
  let startupTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = await Promise.race([
      new Promise<string>((resolve, reject) => {
        startupTimeout = setTimeout(
          () =>
            reject(
              new Error(
                "VoxPilot: OpenCode startup timed out after 30 seconds.",
              ),
            ),
          30_000,
        );
        lines.on("line", (line) => {
          try {
            const message: unknown = JSON.parse(line);
            if (
              typeof message !== "object" ||
              message === null ||
              !("url" in message) ||
              typeof message.url !== "string"
            )
              return;
            const url = new URL(message.url);
            if (
              url.protocol !== "http:" ||
              url.hostname !== "0.0.0.0" ||
              url.username ||
              url.password ||
              url.pathname !== "/" ||
              url.search ||
              url.hash
            ) {
              reject(
                new Error(
                  "VoxPilot: OpenCode reported an invalid private server URL.",
                ),
              );
              return;
            }
            // Keep backend traffic on loopback even though the child listens
            // on every interface. LAN clients use VoxPilot's passwordless /oc
            // proxy, which keeps OpenCode's required credential internal.
            url.hostname = "127.0.0.1";
            resolve(url.origin);
          } catch {
            // Only the JSON readiness record is relevant; never echo raw output.
          }
        });
      }),
      done.then(() => {
        throw new Error(
          "VoxPilot: OpenCode exited before reporting its private server URL. Check the native binary and OpenCode configuration.",
        );
      }),
    ]);
    if (exited || stopped)
      throw new Error("VoxPilot: OpenCode stopped during startup.");
    const client = OpenCode.make({ baseUrl: url, headers: { authorization } });
    const info = await client.server.info({
      signal: AbortSignal.timeout(5000),
    });
    if (info.pid !== child.pid || info.version !== detected) {
      throw new Error(
        "VoxPilot: private OpenCode server identity did not match the launched binary.",
      );
    }
    void startIdleInhibitor(client, controller.signal);
    console.log(
      `OpenCode ${detected} server listening on all interfaces at port ${new URL(url).port}`,
    );
    return { client, url, authorization, close };
  } catch (error) {
    await close();
    throw error;
  } finally {
    clearTimeout(startupTimeout);
    lines.close();
    child.stdout.resume();
  }
}
