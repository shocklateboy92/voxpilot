import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { credentialSource, startTestBackend } from "./backend";
import { client, createWorkspace, model } from "./dev";
import { test as base, expect } from "./fixtures";

const test = base.extend<{ backendDirectory: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires fixture destructuring
  backendDirectory: async ({}, use) => {
    const root = await mkdtemp("/tmp/opencode/voxpilot-e2e-lifecycle-");
    try {
      await use(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
});

async function unusedLocalUrl() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test listener address");
  const url = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return url;
}

async function backendDirectories(parent: string) {
  return (await readdir(parent))
    .filter((directory) => directory.startsWith("voxpilot-e2e-backend-"))
    .sort();
}

test("test projects and sessions never reach the credential source", async ({
  servers,
}) => {
  const source = await credentialSource();
  const workspace = await createWorkspace(servers.root);
  try {
    const session = await client.session.create({
      location: { directory: workspace.directory },
      title: "E2E persistence isolation",
      model,
    });
    expect(
      (await client.project.list()).some(
        (project) => project.id === workspace.projectID,
      ),
    ).toBe(true);
    expect(
      (await source.project.list()).some(
        (project) => project.id === workspace.projectID,
      ),
    ).toBe(false);
    const sourceSessions = await source.session.list({
      project: workspace.projectID,
      limit: 100,
    });
    expect(sourceSessions.data.some((entry) => entry.id === session.id)).toBe(
      false,
    );
  } finally {
    await workspace.dispose();
  }
});

test("independent backends cannot see each other's sessions", async ({
  backendDirectory,
  servers,
}) => {
  const other = await startTestBackend(
    await unusedLocalUrl(),
    randomUUID(),
    backendDirectory,
  );
  try {
    const workspace = await createWorkspace(servers.root);
    try {
      const own = await client.session.create({
        location: { directory: workspace.directory },
        title: "Worker-owned session",
      });
      await expect(
        other.client.session.get({ sessionID: own.id }),
      ).rejects.toMatchObject({ _tag: "SessionNotFoundError" });
      const foreign = await other.client.session.create({
        location: { directory: other.root },
        title: "Foreign backend session",
      });
      await expect(
        client.session.get({ sessionID: foreign.id }),
      ).rejects.toMatchObject({ _tag: "SessionNotFoundError" });
      expect(
        (await client.session.list()).data.map((session) => session.id),
      ).toEqual([own.id]);
      expect(
        (await other.client.session.list()).data.map((session) => session.id),
      ).toEqual([foreign.id]);
    } finally {
      await workspace.dispose();
    }
  } finally {
    await other.stop();
  }
});

test("backend teardown deletes persistence and the next backend starts fresh", async ({
  backendDirectory,
}) => {
  const url = await unusedLocalUrl();
  const password = randomUUID();
  const first = await startTestBackend(url, password, backendDirectory);
  const directory = join(first.root, "workspace");
  try {
    await mkdir(directory);
    await first.client.location.get({ location: { directory } });
    await first.client.session.create({
      location: { directory },
      title: "Disposable session",
    });
    expect(
      (await first.client.project.list()).some(
        (project) => project.canonical === directory,
      ),
    ).toBe(true);
    // Even matching authentication must not let the runner adopt another server.
    const directories = await backendDirectories(backendDirectory);
    await expect(
      startTestBackend(url, password, backendDirectory),
    ).rejects.toThrow(/refusing to reuse|exited during startup/);
    expect(await backendDirectories(backendDirectory)).toEqual(directories);
    expect((await first.client.session.list()).data).toHaveLength(1);
  } finally {
    await first.stop();
  }
  await expect(access(first.root)).rejects.toThrow();
  const second = await startTestBackend(url, password, backendDirectory);
  try {
    expect(second.root).not.toBe(first.root);
    expect(
      (await second.client.project.list()).some(
        (project) => project.canonical === directory,
      ),
    ).toBe(false);
    expect((await second.client.session.list()).data).toHaveLength(0);
  } finally {
    await second.stop();
  }
  await expect(access(second.root)).rejects.toThrow();
});

test("test backend overrides cannot point at a remote or non-origin URL", async () => {
  for (const url of [
    "https://example.invalid",
    "http://192.168.0.110:8001",
    "http://localhost:18001/api",
    "http://localhost:18001?server=normal",
    "http://user:password@localhost:18001",
  ]) {
    await expect(startTestBackend(url, randomUUID())).rejects.toThrow(
      "VOXPILOT_E2E_API must be a local HTTP origin",
    );
  }
});

test("a killed runner cannot leave its backend or database behind", async () => {
  const owner = spawn(
    "bun",
    [
      fileURLToPath(new URL("./backend-owner.ts", import.meta.url)),
      await unusedLocalUrl(),
      randomUUID(),
    ],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  const closed = once(owner, "close");
  try {
    const root = await new Promise<string>((resolve, reject) => {
      owner.once("error", reject);
      owner.once("exit", () => reject(new Error("Backend owner exited early")));
      owner.once("message", (message: unknown) => {
        if (typeof message === "string") resolve(message);
        else reject(new Error("Missing crash-test backend directory"));
      });
    });
    await access(join(root, "opencode.db"));
    owner.kill("SIGKILL");
    await closed;
    await expect
      .poll(() =>
        access(root).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
  } finally {
    owner.kill("SIGKILL");
    await closed;
  }
});
