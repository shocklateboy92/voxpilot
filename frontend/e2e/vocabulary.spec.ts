import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VocabularyFile, VoxPilotRpc } from "../../plugin/src/rpc";
import { expect, idle, send, test } from "./browser";
import { client } from "./dev";

test("agent manages private project vocabulary through ordinary file tools without committing it", async ({
  app,
  workspace,
}) => {
  await send(
    app,
    "Add FixtureVocabularyTerm to this project's private speech vocabulary. Use ordinary file-editing tools, not shell commands. Do not change other files or make commits.",
  );
  await idle(app);
  const privateFile = join(
    workspace.directory,
    ".voxpilot",
    "vocabulary.local.json",
  );
  const words = VocabularyFile.parse(
    JSON.parse(await readFile(privateFile, "utf8")),
  );
  expect(words).toContain("FixtureVocabularyTerm");
  await expect(
    access(join(workspace.directory, ".voxpilot", "vocabulary.json")),
  ).rejects.toThrow();
  const vocabulary = await client
    .rpc(VoxPilotRpc)
    .vocabulary({}, { location: { directory: workspace.directory } });
  expect(vocabulary.terms).toContain("FixtureVocabularyTerm");
  expect(vocabulary.sources.local.path).toBe(privateFile);
  expect((await workspace.git("status", "--porcelain")).stdout).not.toContain(
    "vocabulary",
  );
});

test("agent updates an existing shared JSON array while preserving entries and leaving private/user lists alone", async ({
  app,
  workspace,
}) => {
  const sharedFile = join(workspace.directory, ".voxpilot", "vocabulary.json");
  await mkdir(join(workspace.directory, ".voxpilot"));
  await writeFile(sharedFile, '["ExistingTerm"]\n');
  await workspace.git("add", ".voxpilot/vocabulary.json");
  await workspace.git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "shared vocabulary fixture",
  );
  await send(
    app,
    "Add FixtureSharedTerm to this project's speech vocabulary. Use ordinary file-editing tools, not shell commands. Do not make commits.",
  );
  await idle(app);
  const terms = VocabularyFile.parse(
    JSON.parse(await readFile(sharedFile, "utf8")),
  );
  expect(terms).toContain("ExistingTerm");
  expect(terms).toContain("FixtureSharedTerm");
  await expect(
    access(join(workspace.directory, ".voxpilot", "vocabulary.local.json")),
  ).rejects.toThrow();
  const vocabulary = await client
    .rpc(VoxPilotRpc)
    .vocabulary({}, { location: { directory: workspace.directory } });
  expect(vocabulary.terms).toContain("FixtureSharedTerm");
  expect(vocabulary.sources.user.exists).toBe(false);
  expect((await workspace.git("status", "--porcelain")).stdout).toContain(
    ".voxpilot/vocabulary.json",
  );
});
