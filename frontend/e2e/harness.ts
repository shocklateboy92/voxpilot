import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { ConfigEntry } from "@opencode/client";
import { startProvider } from "./provider";

const frontend = resolve(import.meta.dir, "..");
const plugin = resolve(frontend, "../plugin");
const binary = "opencode";
const vite = resolve(frontend, "node_modules/vite/bin/vite.js");

function port(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (Number.isInteger(value) === false || value < 1 || value > 65535) {
    throw new Error(`${name} must be a TCP port between 1 and 65535`);
  }
  return value;
}

const backendPort = port("VOXPILOT_E2E_BACKEND_PORT", 18001);
const frontendPort = port("VOXPILOT_E2E_PORT", 13000);
const providerPort = port("VOXPILOT_E2E_PROVIDER_PORT", 18002);
const root = await mkdtemp("/tmp/opencode/voxpilot-e2e-");
const workdir = resolve(root, "workspace");
const children: ChildProcess[] = [];
let provider: ReturnType<typeof startProvider> | undefined;
let stopping = false;

async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  // Separate process groups include the backend's embedded OpenCode child.
  for (const child of children) {
    if (child.pid === undefined) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
  provider?.stop(true);
  await Bun.sleep(500);
  for (const child of children) {
    if (child.pid === undefined) continue;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* Already exited. */
    }
  }
  if (process.env.VOXPILOT_E2E_KEEP_ARTIFACTS === "1") {
    console.log(`[e2e] Preserved artifacts: ${root}`);
  } else {
    await rm(root, { recursive: true, force: true });
  }
  process.exit(code);
}

process.once("SIGTERM", () => {
  void stop(0);
});
process.once("SIGINT", () => {
  void stop(0);
});

try {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Do not inherit user OpenCode configuration, auth, or model overrides.
    if (key.startsWith("OPENCODE_") === false) env[key] = value;
  }
  env.HOME = resolve(root, "home");
  env.XDG_DATA_HOME = resolve(root, "data");
  env.XDG_CONFIG_HOME = resolve(root, "config");
  env.XDG_CACHE_HOME = resolve(root, "cache");
  env.XDG_STATE_HOME = resolve(root, "state");
  env.TMPDIR = resolve(root, "tmp");
  // V2 walks parent directories for config unless explicitly disabled.
  env.OPENCODE_CONFIG_PROJECT_DISABLE = "true";
  env.OPENCODE_DISABLE_MODELS_FETCH = "true";
  env.OPENCODE_PASSWORD = "voxpilot-fixture";
  env.VOXPILOT_PLUGIN_DIR = plugin;
  env.OPENCODE_CONFIG_CONTENT = '{"plugins":["{env:VOXPILOT_PLUGIN_DIR}"]}';
  delete env.VOXPILOT_WAKE_URL;
  delete env.DBUS_SESSION_BUS_ADDRESS;
  for (const directory of [
    workdir,
    env.HOME,
    env.XDG_DATA_HOME,
    env.XDG_CONFIG_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_STATE_HOME,
    env.TMPDIR,
  ]) {
    await mkdir(directory, { recursive: true });
  }
  const configDir = resolve(env.XDG_CONFIG_HOME, "opencode");
  await mkdir(configDir, { recursive: true });
  const config = {
    plugins: [plugin],
    update: "disable",
    share: "disabled",
    model: "fixture/baseline",
    default_agent: "baseline",
    experimental: {
      policies: [
        { action: "provider.use", resource: "*", effect: "deny" },
        { action: "provider.use", resource: "fixture", effect: "allow" },
      ],
    },
    snapshots: false,
    lsp: false,
    formatter: false,
    compaction: { auto: false },
    warming: false,
    agents: {
      title: { model: "fixture/baseline" },
      baseline: {
        mode: "primary",
        model: "fixture/baseline",
        description: "Deterministic browser E2E agent",
        permissions: [
          { action: "shell", resource: "*", effect: "ask" },
          { action: "question", resource: "*", effect: "allow" },
        ],
      },
    },
    providers: {
      fixture: {
        name: "Browser fixture",
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: {
          baseURL: `http://127.0.0.1:${providerPort}/v1`,
          apiKey: "fixture",
        },
        models: {
          baseline: {
            name: "Baseline",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 8192, output: 4096 },
          },
        },
      },
    },
  } satisfies Extract<ConfigEntry, { type: "document" }>["info"];
  await Bun.write(
    resolve(configDir, "opencode.json"),
    JSON.stringify(config, null, 2),
  );

  // Neutralize inherited Git overrides and global config without touching the real repo.
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_AUTHOR_NAME = "VoxPilot browser fixture";
  env.GIT_AUTHOR_EMAIL = "fixture@example.invalid";
  env.GIT_COMMITTER_NAME = env.GIT_AUTHOR_NAME;
  env.GIT_COMMITTER_EMAIL = env.GIT_AUTHOR_EMAIL;
  async function git(args: string[]) {
    const child = Bun.spawn(["git", ...args], {
      cwd: workdir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
    return stdout.trim();
  }
  await git(["init", "--initial-branch=main"]);
  await Bun.write(resolve(workdir, "sample.txt"), "old baseline line\n");
  const blob = await git(["hash-object", "-w", "sample.txt"]);
  await git([
    "update-index",
    "--add",
    "--cacheinfo",
    `100644,${blob},sample.txt`,
  ]);
  const tree = await git(["write-tree"]);
  // A real commit in the disposable repo also allows native worktree creation.
  const commit = await git(["commit-tree", tree, "-m", "Browser fixture"]);
  await git(["update-ref", "refs/heads/main", commit]);
  await Bun.write(resolve(workdir, "sample.txt"), "new baseline line\n");

  provider = startProvider({ port: providerPort, workdir });
  function launch(command: string[], cwd: string, childEnv: NodeJS.ProcessEnv) {
    const executable = command[0];
    if (executable === undefined) throw new Error("Missing subprocess command");
    const child = spawn(executable, command.slice(1), {
      cwd,
      env: childEnv,
      stdio: "inherit",
      detached: true,
    });
    children.push(child);
    child.once("error", (error) => {
      console.error("[e2e] Subprocess failed:", error);
      void stop(1);
    });
    child.once("exit", (code, signal) => {
      if (stopping) return;
      console.error(
        `[e2e] Subprocess exited unexpectedly: code=${code} signal=${signal}`,
      );
      void stop(1);
    });
  }
  console.log(`[e2e] Workspace: ${workdir}`);
  console.log(`[e2e] OpenCode binary: ${binary}`);
  console.log(
    `[e2e] Backend: http://127.0.0.1:${backendPort}; fixture: http://127.0.0.1:${providerPort}/health`,
  );
  launch(
    [
      binary,
      "serve",
      "--hostname",
      "0.0.0.0",
      "--port",
      String(backendPort),
      "--cors",
      `http://localhost:${frontendPort}`,
    ],
    workdir,
    env,
  );
  launch(
    [
      process.execPath,
      "--no-env-file",
      vite,
      "--host",
      "0.0.0.0",
      "--port",
      String(frontendPort),
      "--strictPort",
    ],
    frontend,
    {
      ...env,
      VOXPILOT_API_TARGET: `http://127.0.0.1:${backendPort}`,
    },
  );
  const deadline = Date.now() + 60_000;
  for (const url of [
    `http://127.0.0.1:${backendPort}/api/info`,
    `http://127.0.0.1:${frontendPort}`,
  ]) {
    let ready = false;
    while (Date.now() < deadline && stopping === false) {
      try {
        const response = await fetch(url, {
          headers: {
            authorization: `Basic ${Buffer.from("opencode:voxpilot-fixture").toString("base64")}`,
          },
          signal: AbortSignal.timeout(1000),
        });
        ready = response.ok;
        await response.body?.cancel();
        if (ready) break;
      } catch {
        /* Startup is still in progress. */
      }
      await Bun.sleep(200);
    }
    if (ready === false) throw new Error(`Timed out waiting for ${url}`);
  }
  console.log(`[e2e] Ready: http://127.0.0.1:${frontendPort}`);
} catch (error) {
  console.error("[e2e] Harness failed:", error);
  await stop(1);
}
