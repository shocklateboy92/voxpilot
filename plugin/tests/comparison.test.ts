import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureComparison, git } from "../src/services/comparison";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function repository() {
  const root = await mkdtemp("/tmp/opencode/voxpilot-comparison-");
  roots.push(root);
  await git(root, ["init", "--initial-branch=main"]);
  await writeFile(join(root, "original.txt"), "original\n");
  await writeFile(join(root, "delete.txt"), "deleted\n");
  await git(root, ["add", "."]);
  await git(root, [
    "-c",
    "user.name=E2E",
    "-c",
    "user.email=e2e@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "baseline",
  ]);
  return root;
}

test("staged and unstaged comparisons capture distinct contents and apply path filters", async () => {
  const workdir = await repository();
  await writeFile(join(workdir, "original.txt"), "staged\n");
  await git(workdir, ["add", "original.txt"]);
  await writeFile(join(workdir, "original.txt"), "unstaged\n");
  await writeFile(join(workdir, "untracked.txt"), "untracked\n");
  const staged = await captureComparison({
    workdir,
    from: "HEAD",
    to: "INDEX",
    mode: "refs",
  });
  expect(staged.files).toMatchObject([
    {
      filePath: "original.txt",
      beforeContent: "original\n",
      afterContent: "staged\n",
    },
  ]);
  const unstaged = await captureComparison({
    workdir,
    from: "INDEX",
    to: "WORKTREE",
    mode: "refs",
    path: "original.txt",
  });
  expect(unstaged.files).toMatchObject([
    {
      filePath: "original.txt",
      beforeContent: "staged\n",
      afterContent: "unstaged\n",
    },
  ]);
});

test("renames remain complete additions/deletions and odd untracked paths are preserved", async () => {
  const workdir = await repository();
  await git(workdir, ["mv", "original.txt", "renamed.txt"]);
  await rm(join(workdir, "delete.txt"));
  await mkdir(join(workdir, "nested"));
  await writeFile(join(workdir, "nested", "space\tnewline\nfile.txt"), "new\n");
  const snapshot = await captureComparison({
    workdir,
    from: "HEAD",
    to: "WORKTREE",
    mode: "refs",
  });
  expect(snapshot.files.map((file) => file.filePath).sort()).toEqual([
    "delete.txt",
    "nested/space\tnewline\nfile.txt",
    "original.txt",
    "renamed.txt",
  ]);
  expect(
    snapshot.files.find((file) => file.filePath === "original.txt"),
  ).toMatchObject({ beforeContent: "original\n", afterContent: "" });
  expect(
    snapshot.files.find((file) => file.filePath === "renamed.txt"),
  ).toMatchObject({ beforeContent: "", afterContent: "original\n" });
});

test("invalid refs, unsupported comparisons, relative workdirs, and binary tracked files fail clearly", async () => {
  const workdir = await repository();
  await expect(
    captureComparison({ workdir, from: "--help", to: "HEAD", mode: "refs" }),
  ).rejects.toThrow("Invalid Git ref");
  await expect(
    captureComparison({ workdir, from: "WORKTREE", to: "HEAD", mode: "refs" }),
  ).rejects.toThrow("Unsupported comparison");
  await expect(
    captureComparison({
      workdir: "relative",
      from: "HEAD",
      to: "WORKTREE",
      mode: "refs",
    }),
  ).rejects.toThrow("workdir must be absolute");
  await writeFile(join(workdir, "original.txt"), Buffer.from([0, 1, 2]));
  await expect(
    captureComparison({ workdir, from: "HEAD", to: "WORKTREE", mode: "refs" }),
  ).rejects.toThrow("Binary file cannot be formatted");
});
