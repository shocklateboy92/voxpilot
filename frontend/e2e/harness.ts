import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config } from "@opencode-ai/sdk/v2";
import { startProvider } from "./provider";

const frontend = resolve(import.meta.dir, "..");
const backend = resolve(frontend, "../backend/src/index.ts");
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
  env.OPENCODE_DISABLE_AUTOUPDATE = "true";
  env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "true";
  env.OPENCODE_DISABLE_EXTERNAL_SKILLS = "true";
  env.OPENCODE_DISABLE_CLAUDE_CODE = "true";
  env.OPENCODE_DISABLE_MODELS_FETCH = "true";
  env.VOXPILOT_PORT = String(backendPort);
  env.VOXPILOT_OC_PORT = String(port("VOXPILOT_E2E_OC_PORT", 18003));
  env.VOXPILOT_DB_PATH = resolve(root, "voxpilot.db");
  delete env.VOXPILOT_WAKE_URL;
  delete env.DBUS_SESSION_BUS_ADDRESS;
  for (const directory of [
    workdir,
    env.HOME,
    env.XDG_DATA_HOME,
    env.XDG_CONFIG_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_STATE_HOME,
  ]) {
    await mkdir(directory, { recursive: true });
  }
  const configDir = resolve(env.XDG_CONFIG_HOME, "opencode");
  await mkdir(configDir, { recursive: true });
  const config = {
    plugin: [],
    autoupdate: false,
    share: "disabled",
    model: "fixture/baseline",
    small_model: "fixture/baseline",
    default_agent: "baseline",
    enabled_providers: ["fixture"],
    snapshot: false,
    lsp: false,
    formatter: false,
    compaction: { auto: false, prune: false },
    agent: {
      baseline: {
        mode: "primary",
        model: "fixture/baseline",
        description: "Deterministic browser E2E agent",
        permission: { bash: "ask", question: "allow" },
      },
    },
    provider: {
      fixture: {
        name: "Browser fixture",
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: `http://127.0.0.1:${providerPort}/v1`,
          apiKey: "fixture",
        },
        models: {
          baseline: {
            name: "Baseline",
            tool_call: true,
            reasoning: false,
            attachment: false,
            temperature: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 8192, output: 4096 },
          },
        },
      },
    },
  } satisfies Config;
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
  // Git diff/show accept a tree as HEAD. No commit is created, even in this fixture.
  await Bun.write(resolve(workdir, ".git/refs/heads/main"), `${tree}\n`);
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
  console.log(
    `[e2e] Backend: http://127.0.0.1:${backendPort}; fixture: http://127.0.0.1:${providerPort}/health`,
  );
  launch([process.execPath, "--no-env-file", backend], workdir, env);
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
    `http://127.0.0.1:${backendPort}/oc/global/health`,
    `http://127.0.0.1:${frontendPort}`,
  ]) {
    let ready = false;
    while (Date.now() < deadline && stopping === false) {
      try {
        const response = await fetch(url, {
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
