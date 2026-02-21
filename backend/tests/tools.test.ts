import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRegistry } from "../src/tools";
import { GitDiffTool } from "../src/tools/git-diff";
import { GitShowTool } from "../src/tools/git-show";
import { GlobSearchTool } from "../src/tools/glob-search";
import { GrepSearchTool } from "../src/tools/grep-search";
import { ListDirectoryTool } from "../src/tools/list-directory";
import { ReadFileTool } from "../src/tools/read-file";
import { ReadFileExternalTool } from "../src/tools/read-file-external";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "voxpilot-test-"));
  await mkdir(join(workDir, "src"));
  await writeFile(join(workDir, "src", "main.py"), "# main\nprint('hello')\n");
  await writeFile(
    join(workDir, "src", "utils.py"),
    "# utils\ndef helper():\n    return 42\n",
  );
  await mkdir(join(workDir, "src", "nested"));
  await writeFile(join(workDir, "src", "nested", "deep.py"), "# deep\n");
  await mkdir(join(workDir, "docs"));
  await writeFile(join(workDir, "docs", "README.md"), "# README\nSome docs.\n");
  await writeFile(join(workDir, "README.md"), "# Project\nTop-level readme.\n");
  await writeFile(join(workDir, ".gitignore"), "*.pyc\n");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// ── ReadFileTool ───────────────────────────────────────────────────────────────

describe("ReadFileTool", () => {
  const tool = new ReadFileTool();

  it("reads file basic", async () => {
    const result = (await tool.execute({ path: "README.md" }, workDir))
      .displayResult;
    expect(result).toContain("# Project");
    expect(result).toContain("Top-level readme.");
    expect(result).toContain("lines 1-2 of 2");
  });

  it("includes line numbers", async () => {
    const result = (await tool.execute({ path: "src/utils.py" }, workDir))
      .displayResult;
    expect(result).toContain("1 |");
    expect(result).toContain("2 |");
    expect(result).toContain("3 |");
  });

  it("reads line range", async () => {
    const result = (
      await tool.execute(
        { path: "src/utils.py", start_line: 2, end_line: 2 },
        workDir,
      )
    ).displayResult;
    expect(result).toContain("def helper():");
    expect(result).not.toContain("# utils");
  });

  it("errors on not found", async () => {
    const result = (await tool.execute({ path: "nonexistent.py" }, workDir))
      .displayResult;
    expect(result.startsWith("Error:")).toBe(true);
    expect(result).toContain("does not exist");
  });

  it("rejects path traversal", async () => {
    const result = (
      await tool.execute({ path: "../../../etc/passwd" }, workDir)
    ).displayResult;
    expect(result.startsWith("Error:")).toBe(true);
    expect(result).toContain("outside");
  });

  it("errors on directory", async () => {
    const result = (await tool.execute({ path: "src" }, workDir)).displayResult;
    expect(result.startsWith("Error:")).toBe(true);
    expect(result).toContain("not a file");
  });

  it("errors on missing path arg", async () => {
    // With Zod validation, missing required 'path' is caught by registry.execute()
    await expect(
      defaultRegistry.execute("read_file", "{}", workDir),
    ).rejects.toThrow();
  });

  it("errors on too large file", async () => {
    await writeFile(join(workDir, "big.txt"), "x".repeat(200_000));
    const result = (await tool.execute({ path: "big.txt" }, workDir))
      .displayResult;
    expect(result.startsWith("Error:")).toBe(true);
    expect(result).toContain("bytes");
  });

  it("rejects symlink escape", async () => {
    await symlink("/etc/passwd", join(workDir, "escape_link"));
    const result = (await tool.execute({ path: "escape_link" }, workDir))
      .displayResult;
    expect(result.startsWith("Error:")).toBe(true);
  });

  it("rejects absolute path", async () => {
    const result = (await tool.execute({ path: "/etc/passwd" }, workDir))
      .displayResult;
    expect(result.startsWith("Error:")).toBe(true);
  });

  it("reads json (binary extension allowed)", async () => {
    await writeFile(join(workDir, "data.json"), '{"key": "value"}');
    const result = (await tool.execute({ path: "data.json" }, workDir))
      .displayResult;
    expect(result).toContain("key");
  });

  it("preserves unicode encoding", async () => {
    await writeFile(join(workDir, "unicode.txt"), "Hello 🌍 世界\n");
    const result = (await tool.execute({ path: "unicode.txt" }, workDir))
      .displayResult;
    expect(result).toContain("🌍");
    expect(result).toContain("世界");
  });

  it("errors when start > end", async () => {
    const result = (
      await tool.execute(
        { path: "README.md", start_line: 5, end_line: 1 },
        workDir,
      )
    ).displayResult;
    expect(result.startsWith("Error:")).toBe(true);
  });

  it("allows symlink within work dir", async () => {
    await symlink(join(workDir, "README.md"), join(workDir, "link.md"));
    const result = (await tool.execute({ path: "link.md" }, workDir))
      .displayResult;
    expect(result).toContain("# Project");
  });
});

// ── ListDirectoryTool ──────────────────────────────────────────────────────────

describe("ListDirectoryTool", () => {
  const tool = new ListDirectoryTool();

  it("lists root directory", async () => {
    const result = (await tool.execute({ path: "." }, workDir)).displayResult;
    expect(result).toContain("src/");
    expect(result).toContain("docs/");
    expect(result).toContain("README.md");
  });

  it("lists subdirectory", async () => {
    const result = (await tool.execute({ path: "src" }, workDir)).displayResult;
    expect(result).toContain("nested/");
    expect(result).toContain("main.py");
    expect(result).toContain("utils.py");
  });

  it("defaults to root when no path", async () => {
    const result = (await tool.execute({}, workDir)).displayResult;
    expect(result).toContain("src/");
  });

  it("errors on not found", async () => {
    const result = (await tool.execute({ path: "nonexistent" }, workDir))
      .displayResult;
    expect(result.startsWith("Error:")).toBe(true);
  });

  it("skips __pycache__", async () => {
    await mkdir(join(workDir, "__pycache__"));
    await writeFile(join(workDir, "__pycache__", "test.pyc"), "\x00");
    const result = (await tool.execute({ path: "." }, workDir)).displayResult;
    expect(result).not.toContain("__pycache__");
  });

  it("rejects path traversal", async () => {
    const result = (await tool.execute({ path: "../../.." }, workDir))
      .displayResult;
    expect(result.startsWith("Error:")).toBe(true);
  });

  it("lists dirs before files", async () => {
    const result = (await tool.execute({ path: "." }, workDir)).displayResult;
    const lines = result.trim().split("\n");
    const dirIndices = lines
      .map((ln, i) => (ln.endsWith("/") ? i : -1))
      .filter((i) => i >= 0);
    const fileIndices = lines
      .map((ln, i) => (!ln.endsWith("/") && i > 0 ? i : -1))
      .filter((i) => i >= 0);
    if (dirIndices.length > 0 && fileIndices.length > 0) {
      expect(dirIndices[0]).toBeLessThan(fileIndices[0]);
    }
  });

  it("reports empty directory", async () => {
    await mkdir(join(workDir, "empty"));
    const result = (await tool.execute({ path: "empty" }, workDir))
      .displayResult;
    expect(result.toLowerCase()).toContain("empty");
  });

  it("errors when path is a file", async () => {
    const result = (await tool.execute({ path: "README.md" }, workDir))
      .displayResult;
    expect(result.startsWith("Error:")).toBe(true);
    expect(result).toContain("not a directory");
  });
});

// ── GrepSearchTool ─────────────────────────────────────────────────────────────

describe("GrepSearchTool", () => {
  const tool = new GrepSearchTool();

  it("finds basic pattern", async () => {
    const result = (await tool.execute({ pattern: "hello" }, workDir))
      .displayResult;
    expect(result).toContain("main.py");
    expect(result).toContain("hello");
  });

  it("reports no match", async () => {
    const result = (
      await tool.execute({ pattern: "nonexistent_string_xyz" }, workDir)
    ).displayResult;
    expect(result).toContain("No matches");
  });

  it("filters with include glob", async () => {
    const result = (
      await tool.execute({ pattern: "#", include: "*.md" }, workDir)
    ).displayResult;
    expect(result).toContain("README.md");
    expect(result).not.toContain("main.py");
  });

  it("restricts to path", async () => {
    const result = (await tool.execute({ pattern: "#", path: "docs" }, workDir))
      .displayResult;
    expect(result).toContain("docs");
    // Should not find root README
    const lines = result.split("\n").filter((ln) => ln.startsWith("README.md"));
    expect(lines).toHaveLength(0);
  });

  it("errors on invalid regex", async () => {
    const result = (await tool.execute({ pattern: "[invalid" }, workDir))
      .displayResult;
    expect(result.startsWith("Error:")).toBe(true);
    expect(result.toLowerCase()).toContain("regex");
  });

  it("is case insensitive", async () => {
    const result = (await tool.execute({ pattern: "HELLO" }, workDir))
      .displayResult;
    expect(result).toContain("main.py");
  });

  it("rejects path traversal", async () => {
    const result = (
      await tool.execute({ pattern: "root", path: "../../.." }, workDir)
    ).displayResult;
    expect(result.startsWith("Error:")).toBe(true);
  });

  it("includes line numbers", async () => {
    const result = (await tool.execute({ pattern: "def helper" }, workDir))
      .displayResult;
    expect(result).toContain(":2:");
  });

  it("skips binary files", async () => {
    await writeFile(
      join(workDir, "image.png"),
      Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        ...new Array(100).fill(0x00),
      ]),
    );
    const result = (await tool.execute({ pattern: "PNG" }, workDir))
      .displayResult;
    expect(result).not.toContain("image.png");
  });

  it("errors on missing pattern", async () => {
    // With Zod validation, missing required 'pattern' is caught by registry.execute()
    await expect(
      defaultRegistry.execute("grep_search", "{}", workDir),
    ).rejects.toThrow();
  });
});

// ── GlobSearchTool ─────────────────────────────────────────────────────────────

describe("GlobSearchTool", () => {
  const tool = new GlobSearchTool();

  it("finds all py files", async () => {
    const result = (await tool.execute({ pattern: "**/*.py" }, workDir))
      .displayResult;
    expect(result).toContain("src/main.py");
    expect(result).toContain("src/utils.py");
    expect(result).toContain("src/nested/deep.py");
  });

  it("finds md files", async () => {
    const result = (await tool.execute({ pattern: "**/*.md" }, workDir))
      .displayResult;
    expect(result).toContain("README.md");
    expect(result).toContain("docs/README.md");
  });

  it("restricts to path", async () => {
    const result = (
      await tool.execute({ pattern: "*.py", path: "src" }, workDir)
    ).displayResult;
    expect(result).toContain("main.py");
    expect(result).not.toContain("deep.py");
  });

  it("reports no match", async () => {
    const result = (await tool.execute({ pattern: "**/*.rs" }, workDir))
      .displayResult;
    expect(result).toContain("No files found");
  });

  it("skips __pycache__", async () => {
    await mkdir(join(workDir, "__pycache__"));
    await writeFile(join(workDir, "__pycache__", "test.pyc"), "\x00");
    const result = (await tool.execute({ pattern: "**/*.pyc" }, workDir))
      .displayResult;
    expect(result).toContain("No files found");
  });

  it("rejects path traversal", async () => {
    const result = (
      await tool.execute({ pattern: "*.py", path: "../../.." }, workDir)
    ).displayResult;
    expect(result.startsWith("Error:")).toBe(true);
  });

  it("errors on missing pattern", async () => {
    // With Zod validation, missing required 'pattern' is caught by registry.execute()
    await expect(
      defaultRegistry.execute("glob_search", "{}", workDir),
    ).rejects.toThrow();
  });

  it("errors when path is not a directory", async () => {
    const result = (
      await tool.execute({ pattern: "*.py", path: "README.md" }, workDir)
    ).displayResult;
    expect(result.startsWith("Error:")).toBe(true);
  });
});

// ── Tool Framework ─────────────────────────────────────────────────────────────

describe("ToolRegistry", () => {
  it("has all 8 tools", () => {
    const tools = defaultRegistry.all();
    expect(tools).toHaveLength(8);
    const names = new Set(tools.map((t) => t.name));
    expect(names).toEqual(
      new Set([
        "read_file",
        "list_directory",
        "grep_search",
        "glob_search",
        "read_file_external",
        "git_diff",
        "git_show",
        "copilot_agent",
      ]),
    );
  });

  it("produces OpenAI format", () => {
    const specs = defaultRegistry.toOpenAiTools();
    expect(specs).toHaveLength(8);
    for (const spec of specs) {
      expect(spec.type).toBe("function");
      expect(spec.function.name).toBeTruthy();
      expect(spec.function.description).toBeTruthy();
      expect(spec.function.parameters).toBeTruthy();
    }
  });

  it("gets tool by name", () => {
    const tool = defaultRegistry.get("read_file");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("read_file");
    expect(defaultRegistry.get("nonexistent")).toBeUndefined();
  });

  it("execute rejects unknown tool", async () => {
    await expect(
      defaultRegistry.execute("nonexistent_tool", "{}", workDir),
    ).rejects.toThrow("Unknown tool");
  });

  it("execute rejects missing required arg via Zod", async () => {
    // 'path' is required for read_file — passing {} should throw a Zod validation error
    await expect(
      defaultRegistry.execute("read_file", "{}", workDir),
    ).rejects.toThrow();
  });

  it("execute rejects missing required arg for grep_search", async () => {
    await expect(
      defaultRegistry.execute("grep_search", "{}", workDir),
    ).rejects.toThrow();
  });
});

// ── Confirmation flag ──────────────────────────────────────────────────────────

describe("requiresConfirmation", () => {
  it("read-only tools default to false", () => {
    expect(new ReadFileTool().requiresConfirmation).toBe(false);
    expect(new ListDirectoryTool().requiresConfirmation).toBe(false);
  });

  it("read_file_external requires confirmation", () => {
    expect(new ReadFileExternalTool().requiresConfirmation).toBe(true);
  });
});

// ── ReadFileExternalTool ───────────────────────────────────────────────────────

describe("ReadFileExternalTool", () => {
  const tool = new ReadFileExternalTool();

  it("reads absolute path", async () => {
    const testFile = join(workDir, "external.txt");
    await writeFile(testFile, "line one\nline two\n");
    const result = (await tool.execute({ path: testFile }, workDir))
      .displayResult;
    expect(result).toContain("line one");
    expect(result).toContain("line two");
    expect(result).toContain("lines 1-2 of 2");
  });

  it("errors on file not found", async () => {
    const result = (
      await tool.execute({ path: "/nonexistent/file.txt" }, workDir)
    ).displayResult;
    expect(result.startsWith("Error:")).toBe(true);
    expect(result).toContain("does not exist");
  });

  it("reads line range", async () => {
    const testFile = join(workDir, "multi.txt");
    await writeFile(testFile, "a\nb\nc\nd\ne\n");
    const result = (
      await tool.execute(
        { path: testFile, start_line: 2, end_line: 4 },
        workDir,
      )
    ).displayResult;
    expect(result).toContain("b");
    expect(result).toContain("c");
    expect(result).toContain("d");
    expect(result).toContain("lines 2-4 of 5");
  });

  it("errors on empty path", async () => {
    const result = (await tool.execute({ path: "" }, workDir)).displayResult;
    expect(result.startsWith("Error:")).toBe(true);
  });
});

// ── Helper: initialize a git repo in a temp directory ──────────────────────────

async function initGitRepo(dir: string): Promise<void> {
  const run = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });

  await run(["init"]).exited;
  await run(["config", "user.email", "test@test.com"]).exited;
  await run(["config", "user.name", "Test"]).exited;
}

async function gitCommit(dir: string, message: string): Promise<string> {
  const run = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });

  await run(["add", "-A"]).exited;
  await run(["commit", "-m", message]).exited;

  const shaProc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const sha = (await new Response(shaProc.stdout).text()).trim();
  await shaProc.exited;
  return sha;
}

// ── GitDiffTool ────────────────────────────────────────────────────────────────

describe("GitDiffTool", () => {
  const tool = new GitDiffTool();
  let gitDir: string;

  beforeEach(async () => {
    gitDir = await mkdtemp(join(tmpdir(), "voxpilot-git-diff-"));
    await initGitRepo(gitDir);
    await writeFile(join(gitDir, "file.txt"), "line one\n");
    await gitCommit(gitDir, "initial commit");
  });

  afterEach(async () => {
    await rm(gitDir, { recursive: true, force: true });
  });

  it("shows unstaged changes (default from=INDEX to=WORKTREE)", async () => {
    await writeFile(join(gitDir, "file.txt"), "line one\nline two\n");
    const result = await tool.execute({}, gitDir);
    expect(result.displayResult).toContain("line two");
    expect(result.displayResult).toContain("diff --git");
    // llmResult should have stat summary but not the full diff hunk
    expect(result.llmResult).toContain("file.txt");
    expect(result.llmResult).not.toContain("diff --git");
  });

  it("shows staged changes (from=HEAD to=INDEX)", async () => {
    await writeFile(join(gitDir, "file.txt"), "modified\n");
    await Bun.spawn(["git", "add", "file.txt"], {
      cwd: gitDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    const result = await tool.execute({ from: "HEAD", to: "INDEX" }, gitDir);
    expect(result.displayResult).toContain("modified");
    expect(result.displayResult).toContain("diff --git");
    expect(result.llmResult).toContain("file.txt");
  });

  it("shows all uncommitted changes (from=HEAD to=WORKTREE)", async () => {
    await writeFile(join(gitDir, "file.txt"), "line one\nline two\n");
    const result = await tool.execute({ from: "HEAD", to: "WORKTREE" }, gitDir);
    expect(result.displayResult).toContain("line two");
    expect(result.displayResult).toContain("diff --git");
  });

  it("scopes to a path", async () => {
    await mkdir(join(gitDir, "sub"));
    await writeFile(join(gitDir, "sub", "a.txt"), "new file\n");
    await writeFile(join(gitDir, "other.txt"), "other\n");
    await Bun.spawn(["git", "add", "-A"], {
      cwd: gitDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    const result = await tool.execute(
      { from: "HEAD", to: "INDEX", path: "sub" },
      gitDir,
    );
    expect(result.displayResult).toContain("a.txt");
    expect(result.displayResult).not.toContain("other.txt");
  });

  it("reports no changes", async () => {
    const result = await tool.execute({}, gitDir);
    expect(result.displayResult).toContain("No changes found");
    expect(result.llmResult).toContain("No changes found");
  });

  it("rejects same from and to", async () => {
    const result = await tool.execute({ from: "HEAD", to: "HEAD" }, gitDir);
    expect(result.displayResult).toContain("Error");
    expect(result.displayResult).toContain("must be different");
  });

  it("rejects invalid refs", async () => {
    const result = await tool.execute({ from: "--flag" }, gitDir);
    expect(result.displayResult).toContain("Error");
    expect(result.displayResult).toContain("invalid ref");
  });

  it("errors on non-git directory", async () => {
    const nonGit = await mkdtemp(join(tmpdir(), "voxpilot-nogit-"));
    try {
      const result = await tool.execute({}, nonGit);
      expect(result.displayResult.startsWith("Error:")).toBe(true);
      expect(result.displayResult).toContain("not inside a git repository");
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });
});

// ── GitShowTool ────────────────────────────────────────────────────────────────

describe("GitShowTool", () => {
  const tool = new GitShowTool();
  let gitDir: string;
  let initialSha: string;

  beforeEach(async () => {
    gitDir = await mkdtemp(join(tmpdir(), "voxpilot-git-show-"));
    await initGitRepo(gitDir);
    await writeFile(join(gitDir, "file.txt"), "hello\n");
    initialSha = await gitCommit(gitDir, "initial commit");
  });

  afterEach(async () => {
    await rm(gitDir, { recursive: true, force: true });
  });

  it("shows HEAD commit", async () => {
    const result = await tool.execute({}, gitDir);
    expect(result.displayResult).toContain("initial commit");
    expect(result.displayResult).toContain("diff --git");
    expect(result.displayResult).toContain("hello");
    // llmResult has commit info + stat but no patch
    expect(result.llmResult).toContain("initial commit");
    expect(result.llmResult).toContain("file.txt");
    expect(result.llmResult).not.toContain("diff --git");
  });

  it("shows specific SHA", async () => {
    await writeFile(join(gitDir, "file.txt"), "updated\n");
    await gitCommit(gitDir, "second commit");
    const result = await tool.execute({ commit: initialSha }, gitDir);
    expect(result.displayResult).toContain("initial commit");
    expect(result.displayResult).not.toContain("second commit");
  });

  it("rejects invalid ref", async () => {
    const result = await tool.execute({ commit: "HEAD; rm -rf /" }, gitDir);
    expect(result.displayResult.startsWith("Error:")).toBe(true);
    expect(result.displayResult).toContain("invalid commit reference");
  });

  it("rejects flag injection", async () => {
    const result = await tool.execute({ commit: "--all" }, gitDir);
    expect(result.displayResult.startsWith("Error:")).toBe(true);
    expect(result.displayResult).toContain("invalid commit reference");
  });

  it("errors on non-git directory", async () => {
    const nonGit = await mkdtemp(join(tmpdir(), "voxpilot-nogit-"));
    try {
      const result = await tool.execute({}, nonGit);
      expect(result.displayResult.startsWith("Error:")).toBe(true);
      expect(result.displayResult).toContain("not inside a git repository");
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });

  it("errors on unknown commit", async () => {
    const result = await tool.execute({ commit: "deadbeefdeadbeef" }, gitDir);
    expect(result.displayResult.startsWith("Error:")).toBe(true);
  });

  it("llmResult is shorter than displayResult", async () => {
    const result = await tool.execute({}, gitDir);
    expect(result.llmResult.length).toBeLessThan(result.displayResult.length);
  });
});
