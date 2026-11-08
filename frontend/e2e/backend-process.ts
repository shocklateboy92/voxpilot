/** Keep cleanup alive even if the Playwright runner exits before its teardown. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = process.argv[2];
if (!directory) throw new Error("Missing disposable backend directory");
const root = directory;
const repo = fileURLToPath(new URL("../../", import.meta.url));
const child = spawn(join(repo, "packaging/voxpilot-opencode"), {
  cwd: repo,
  // Never expose the password OpenCode prints at startup.
  stdio: "ignore",
  env: process.env,
});
const closed = once(child, "close").catch(() => undefined);
if (child.pid !== undefined) process.send?.(child.pid);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    child.kill("SIGTERM");
    await closed;
  } finally {
    clearTimeout(timer);
    await rm(root, { recursive: true, force: true });
    process.exit(0);
  }
}

// The runner owns the write end. EOF also happens when it crashes or is killed.
process.stdin.resume();
process.stdin.once("end", () => void stop());
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
void closed.then(stop);
