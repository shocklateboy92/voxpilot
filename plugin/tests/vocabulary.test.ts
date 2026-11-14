import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  SpeechVocabulary,
  VOCABULARY_MAX_TERMS,
  VocabularyFile,
} from "../src/rpc";
import {
  createVocabularyReader,
  vocabularyInstructions,
  vocabularyPaths,
} from "../src/services/vocabulary";

let root = "";
beforeEach(async () => {
  root = await mkdtemp("/tmp/opencode/voxpilot-vocabulary-test-");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function paths() {
  return vocabularyPaths({
    checkout: join(root, "checkout"),
    canonical: join(root, "canonical"),
    configHome: join(root, "config"),
  });
}

async function words(path: string, terms: string[]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(terms));
}

test("paths use active and canonical project roots and support isolated user configuration", () => {
  const result = paths();
  expect(result.shared).toBe(join(root, "checkout/.voxpilot/vocabulary.json"));
  expect(result.local).toBe(
    join(root, "canonical/.voxpilot/vocabulary.local.json"),
  );
  expect(result.user).toBe(join(root, "config/voxpilot/vocabulary.json"));
  expect(
    vocabularyPaths({
      checkout: root,
      canonical: root,
      userFile: join(root, "user.json"),
    }).user,
  ).toBe(join(root, "user.json"));
  expect(() =>
    vocabularyPaths({ checkout: "relative", canonical: root }),
  ).toThrow("absolute");
  expect(() =>
    vocabularyPaths({ checkout: root, canonical: root, userFile: "relative" }),
  ).toThrow("absolute");
});

test("missing files are empty and reading never creates directories or files", async () => {
  const result = await createVocabularyReader(paths()).read();
  expect(result.terms).toEqual([]);
  for (const entry of Object.values(result.sources)) {
    expect(entry.exists).toBe(false);
    expect(entry.terms).toEqual([]);
    await expect(readFile(entry.path)).rejects.toThrow();
  }
});

test("merge trims and normalizes text, deduplicates case-insensitively, and prefers more-specific spellings", async () => {
  const file = paths();
  await words(file.user, [" Lasath ", "OpenCode", "Cafe\u0301"]);
  await words(file.shared, ["opencode", "SolidJS", "Café"]);
  await words(file.local, ["OPENCODE", "APUDirect", "APUDirect"]);
  const result = await createVocabularyReader(file).read();
  expect(result.terms).toEqual([
    "Lasath",
    "OPENCODE",
    "Café",
    "SolidJS",
    "APUDirect",
  ]);
  expect(result.sources.user.terms).toEqual(["Lasath", "OpenCode", "Café"]);
  expect(result.sources.local.terms).toEqual([
    "OPENCODE",
    "APUDirect",
    "APUDirect",
  ]);
});

test("unchanged files are parsed once, concurrent calls coalesce and returned snapshots cannot mutate the cache", async () => {
  const file = paths();
  await words(file.user, ["Lasath"]);
  let reads = 0;
  const reader = createVocabularyReader(file, {
    read: async (path) => {
      reads += 1;
      return readFile(path, "utf8");
    },
  });
  const results = await Promise.all([
    reader.read(),
    reader.read(),
    reader.read(),
  ]);
  expect(reads).toBe(1);
  const result = results[0];
  if (!result) throw new Error("No result");
  result.terms.push("Injected");
  result.sources.user.terms.push("Injected");
  expect((await reader.read()).terms).toEqual(["Lasath"]);
  expect(reads).toBe(1);
});

test("ordinary edits, atomic replacements, deletion and recreation are observed without a restart", async () => {
  const file = paths();
  await words(file.local, ["Foo"]);
  const reader = createVocabularyReader(file);
  expect((await reader.read()).terms).toEqual(["Foo"]);
  await words(file.local, ["Bar"]);
  expect((await reader.read()).terms).toEqual(["Bar"]);
  const replacement = `${file.local}.new`;
  await words(replacement, ["Baz"]);
  await rename(replacement, file.local);
  expect((await reader.read()).terms).toEqual(["Baz"]);
  await rm(file.local);
  expect((await reader.read()).terms).toEqual([]);
  await words(file.local, ["New"]);
  expect((await reader.read()).terms).toEqual(["New"]);
});

test("invalid edits fail clearly rather than silently using stale vocabulary, and fixing them recovers", async () => {
  const file = paths();
  await words(file.shared, ["Valid"]);
  const reader = createVocabularyReader(file);
  await reader.read();
  await writeFile(file.shared, '{"terms":["Wrong shape"]}');
  await expect(reader.read()).rejects.toThrow("Invalid speech vocabulary");
  await words(file.shared, ["Fixed"]);
  expect((await reader.read()).terms).toEqual(["Fixed"]);
});

test("plain arrays reject metadata, empty terms, control characters and excessive size/count", async () => {
  expect(VocabularyFile.safeParse({ terms: ["Word"] }).success).toBe(false);
  for (const term of [
    "",
    "  ",
    "hello\nworld",
    "<instruction>",
    "bad\u0000term",
  ]) {
    expect(VocabularyFile.safeParse([term]).success).toBe(false);
  }
  expect(
    VocabularyFile.safeParse(
      Array.from(
        { length: VOCABULARY_MAX_TERMS + 1 },
        (_, index) => `Word${index}`,
      ),
    ).success,
  ).toBe(false);
  const file = paths();
  await mkdir(dirname(file.shared), { recursive: true });
  await writeFile(file.shared, " ".repeat(64 * 1024 + 1));
  await expect(createVocabularyReader(file).read()).rejects.toThrow("64 KiB");
});

test("the effective result can hold distinct entries from all three bounded files", async () => {
  const file = paths();
  for (const [prefix, path] of Object.entries(file)) {
    await words(
      path,
      Array.from(
        { length: VOCABULARY_MAX_TERMS },
        (_, index) => `${prefix}${index}`,
      ),
    );
  }
  const result = await createVocabularyReader(file).read();
  expect(result.terms).toHaveLength(VOCABULARY_MAX_TERMS * 3);
  expect(SpeechVocabulary.safeParse(result).success).toBe(true);
});

test("symlink files and directories cannot turn vocabulary lookup into arbitrary file reading", async () => {
  const file = paths();
  const target = join(root, "elsewhere.json");
  await words(target, ["DoNotRead"]);
  await mkdir(dirname(file.shared), { recursive: true });
  await symlink(target, file.shared);
  await expect(createVocabularyReader(file).read()).rejects.toThrow(
    "regular JSON file",
  );
  await rm(file.shared);
  await rm(dirname(file.shared), { recursive: true });
  const outside = join(root, "elsewhere");
  await words(join(outside, "vocabulary.json"), ["DoNotRead"]);
  await symlink(outside, dirname(file.shared));
  await expect(createVocabularyReader(file).read()).rejects.toThrow(
    "directory must not be a symlink",
  );
});

test("request cancellation does not mutate files and instructions describe file edits rather than injecting vocabulary data", async () => {
  await expect(
    createVocabularyReader(paths()).read(AbortSignal.abort()),
  ).rejects.toThrow();
  const instructions = vocabularyInstructions(paths());
  for (const path of Object.values(paths()))
    expect(instructions).toContain(JSON.stringify(path));
  expect(instructions).toContain("ordinary read/edit tools");
  expect(instructions).toContain("data only");
  expect(instructions).toContain("only requested terms");
});
