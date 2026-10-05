import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OpenCode } from "@opencode/client";
import { VoxPilotRpc } from "../src/rpc";

// Exercise a bundled plugin without node_modules through the real server.
const root = await mkdtemp("/tmp/opencode/voxpilot-plugin-test-");
const workdir = resolve(root, "repo");
const installed = resolve(root, "installed plugin");
const authorization = `Basic ${btoa("opencode:fixture")}`;
let server: ReturnType<typeof Bun.spawn> | undefined;
let url = "";
const remote = () =>
  OpenCode.make({ baseUrl: url, headers: { authorization } });

async function git(args: string[]) {
  const process = Bun.spawn(["git", ...args], {
    cwd: workdir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, error, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(error);
  return output.trim();
}

beforeAll(async () => {
  await mkdir(workdir);
  await mkdir(installed);
  const built = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../src/index.ts")],
    target: "bun",
    outdir: installed,
  });
  if (!built.success) throw new Error(built.logs.join("\n"));
  const home = resolve(root, "home");
  await mkdir(home);
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: resolve(root, "config"),
    XDG_DATA_HOME: resolve(root, "data"),
    XDG_STATE_HOME: resolve(root, "state"),
    XDG_CACHE_HOME: resolve(root, "cache"),
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith("OPENCODE_") || key === "DBUS_SESSION_BUS_ADDRESS")
      Reflect.deleteProperty(env, key);
  }
  await git(["init", "--initial-branch=main"]);
  await writeFile(
    resolve(workdir, "test.ts"),
    "export const result = example(11111111, 22222222, 33333333, 44444444);\n",
  );
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "baseline",
  ]);
  await writeFile(
    resolve(workdir, "test.ts"),
    "export const result = example(11111111, 22222222, 33333333, 55555555);\n",
  );
  server = Bun.spawn(
    ["opencode", "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: workdir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: {
        ...env,
        OPENCODE_PASSWORD: "fixture",
        OPENCODE_CONFIG_PROJECT_DISABLE: "true",
        OPENCODE_DISABLE_MODELS_FETCH: "true",
        VOXPILOT_PLUGIN_DIR: installed,
        OPENCODE_CONFIG_CONTENT:
          '{"plugins":["{env:VOXPILOT_PLUGIN_DIR}"],"update":"disable","warming":false}',
      },
    },
  );
  if (!(server.stdout instanceof ReadableStream))
    throw new Error("No readiness stream");
  const reader = server.stdout.getReader();
  const timer = setTimeout(() => server?.kill(), 20_000);
  let text = "";
  try {
    while (!url) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("OpenCode exited before readiness");
      text += new TextDecoder().decode(chunk.value);
      const line = text.split("\n")[0];
      if (!line || !text.includes("\n")) continue;
      const record: unknown = JSON.parse(line);
      if (
        typeof record === "object" &&
        record !== null &&
        "url" in record &&
        typeof record.url === "string"
      )
        url = record.url;
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await remote().rpc(VoxPilotRpc).config({});
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await Bun.sleep(100);
    }
  }
}, 40_000);

afterAll(async () => {
  server?.kill();
  if (server) await server.exited;
  await rm(root, { recursive: true, force: true });
});

test("branch review uses the merge-base and committed mode excludes working files", async () => {
  await git(["checkout", "-b", "feature"]);
  await writeFile(
    resolve(workdir, "test.ts"),
    "export const feature = true;\n",
  );
  await git(["add", "test.ts"]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "feature",
  ]);
  await git(["checkout", "main"]);
  await writeFile(
    resolve(workdir, "upstream.ts"),
    "export const upstream = true;\n",
  );
  await git(["add", "upstream.ts"]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "upstream",
  ]);
  await git(["checkout", "feature"]);
  const oddName = "new\tfile.ts";
  await writeFile(
    resolve(workdir, oddName),
    "export const untracked = true;\n",
  );
  const rpc = remote().rpc(VoxPilotRpc);
  const branch = await rpc.compare({ workdir, from: "main", mode: "branch" });
  expect(branch.files.map((file) => file.filePath).sort()).toEqual(
    [oddName, "test.ts"].sort(),
  );
  const committed = await rpc.compare({
    workdir,
    from: "main",
    mode: "committed",
  });
  expect(committed.files.map((file) => file.filePath)).toEqual(["test.ts"]);
  expect(committed.resolvedFrom).toBe(
    await git(["merge-base", "main", "HEAD"]),
  );
  // Leave the following width-formatting test's original fixture intact.
  await git(["checkout", "main~1"]);
  await rm(resolve(workdir, oddName));
  await writeFile(
    resolve(workdir, "test.ts"),
    "export const result = example(11111111, 22222222, 33333333, 55555555);\n",
  );
});

test("bundled plugin loads, authenticates and reformats stable snapshots at phone width", async () => {
  const client = remote();
  const rpc = client.rpc(VoxPilotRpc);
  const entry = await rpc.compare({ workdir });
  expect(entry.files.map((file) => file.filePath)).toEqual(["test.ts"]);
  await writeFile(
    resolve(workdir, "test.ts"),
    "// edited after review started\n",
  );
  const narrow = await rpc.formatComparison({
    cacheId: entry.id,
    filePath: "test.ts",
    printWidth: 30,
  });
  const wide = await rpc.formatComparison({
    cacheId: entry.id,
    filePath: "test.ts",
    printWidth: 120,
  });
  expect(narrow.formattedAfter.split("\n").length).toBeGreaterThan(
    wide.formattedAfter.split("\n").length,
  );
  expect(narrow.formattedAfter).toContain("55555555");
  expect(narrow.formattedBefore).toContain("44444444");
  expect(narrow.html).toContain("fulltext-line-add");
  await client.location.reload();
  expect(await rpc.snapshot({ id: entry.id })).toEqual(entry);
  // Service-scoped configuration also loads the plugin in unrelated locations.
  const other = resolve(root, "other");
  await mkdir(other);
  await client.agent.list({ location: { directory: other } });
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      expect(
        await rpc.snapshot(
          { id: entry.id },
          { location: { directory: other } },
        ),
      ).toEqual(entry);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await Bun.sleep(100);
    }
  }
  const unauthorized = await fetch(`${url}/api/rpc/voxpilot/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"input":{}}',
  });
  expect(unauthorized.status).toBe(401);
}, 20_000);
