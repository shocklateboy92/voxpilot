import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { type ConfigEntry, type ModelRef, OpenCode } from "@opencode/client";
import { expect } from "@playwright/test";

export const model = {
  providerID: "github-copilot",
  id: "gpt-6-luna",
  variant: "none",
} satisfies ModelRef;
export const modelKey = `${model.providerID}/${model.id}`;
export const password = process.env.OPENCODE_PASSWORD ?? "";
export const client = OpenCode.make({
  baseUrl: process.env.VOXPILOT_E2E_API ?? "http://127.0.0.1:18001",
  headers: password
    ? {
        authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      }
    : {},
});

const exec = promisify(execFile);

/** Test data on the real server; all repositories and worktrees belong to this run. */
export async function createWorkspace() {
  // A freshly started server can answer /api/info before providers finish loading.
  await expect
    .poll(
      async () => {
        const models = await client.model.list();
        return models.data.some(
          (entry) =>
            entry.providerID === model.providerID &&
            entry.id === model.id &&
            entry.enabled,
        );
      },
      {
        message: `E2E requires the authenticated ${modelKey} model`,
        timeout: 30_000,
      },
    )
    .toBe(true);

  const root = await mkdtemp("/tmp/opencode/voxpilot-e2e-");
  const directory = join(root, "repo");
  await mkdir(directory);
  const agents = await client.agent.list();
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: modelKey,
    warming: false,
    compaction: { auto: false },
    worktree: { directory: join(root, "worktrees") },
    agents: {
      ...Object.fromEntries(
        [
          ...agents.data.map((agent) => agent.id),
          "title",
          "summary",
          "compaction",
        ].map((id) => [id, { model: `${modelKey}#none` }]),
      ),
      build: {
        model: `${modelKey}#none`,
        permissions: [
          { action: "shell", resource: "*", effect: "ask" },
          { action: "question", resource: "*", effect: "allow" },
          { action: "subagent", resource: "*", effect: "deny" },
        ],
      },
    },
  } satisfies Extract<ConfigEntry, { type: "document" }>["info"];
  // An ancestor config also covers worktrees created through the UI.
  await writeFile(join(root, "opencode.json"), JSON.stringify(config));
  async function git(...args: string[]) {
    return exec("git", args, { cwd: directory });
  }
  await git("init", "--initial-branch=main");
  await writeFile(join(directory, "sample.txt"), "old baseline line\n");
  await writeFile(join(directory, "second.txt"), "old second line\n");
  await git("add", "sample.txt", "second.txt");
  // Include the unique path so independent runs cannot share a native project ID.
  await git(
    "-c",
    "user.name=VoxPilot E2E",
    "-c",
    "user.email=e2e@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    `VoxPilot E2E ${root}`,
  );
  await writeFile(join(directory, "sample.txt"), "new baseline line\n");
  await writeFile(join(directory, "second.txt"), "new second line\n");
  const location = await client.location.get({ location: { directory } });

  async function cleanSessions() {
    for (;;) {
      const sessions = await client.session.list({
        project: location.project.id,
        limit: 100,
      });
      if (sessions.data.length === 0) break;
      for (const session of sessions.data) {
        await client.session.interrupt({ sessionID: session.id });
        await client.session.remove({ sessionID: session.id });
      }
    }
  }
  return {
    root,
    directory,
    git,
    projectID: location.project.id,
    cleanSessions,
    async dispose() {
      await cleanSessions();
      // Saved permissions created by these tests are project-scoped, never global.
      const permissions = await client.permission.saved.list({
        projectID: location.project.id,
      });
      for (const permission of permissions)
        await client.permission.saved.remove({ id: permission.id });
      const worktrees = await client.worktree.list({
        projectID: location.project.id,
      });
      for (const worktree of worktrees) {
        if (worktree.directory === directory) continue;
        await client.worktree.remove({
          projectID: location.project.id,
          directory: worktree.directory,
          force: true,
        });
      }
      await client.debug.location.evict({ location: { directory } });
      await rm(root, { recursive: true, force: true });
    },
  };
}

export const markdownPrompt = `Return exactly the following Markdown, without wrapping it in another code fence. Do not use tools.
# Baseline response

Browser baseline passed.

- First item
- Second item

\`\`\`text
baseline code
\`\`\``;

export const longPrompt =
  "Do not use tools. Output exactly 100 lines, numbered 1 through 100. Each line must be 'Streaming baseline chunk N.' with N replaced by its number. Do not omit any lines or add commentary.";
