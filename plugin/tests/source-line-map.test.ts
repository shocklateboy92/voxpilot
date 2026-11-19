import { expect, test } from "bun:test";
import { formatAndDiff } from "../src/services/format-diff";
import { mapSourceLine } from "../src/services/source-line-map";

test("maps the intended repeated call by position at different widths", async () => {
  const before = [
    'run("first long argument", "second long argument", "third long argument");',
    "repeat();",
    'run("fourth long argument", "fifth long argument", "sixth long argument");',
    "repeat();",
  ].join("\n");
  const after = `${before}\nadded();\n`;
  const format = (printWidth: number) =>
    formatAndDiff({
      before,
      after,
      printWidth,
      filePath: "example.ts",
      sourceLine: { side: "after", line: 4 },
    });
  const [narrow, wide] = await Promise.all([format(40), format(120)]);
  for (const result of [narrow, wide]) {
    const lines = result.formattedAfter.split("\n");
    expect(result.targetRow).toEqual({
      side: "after",
      line: lines.lastIndexOf("repeat();") + 1,
    });
  }
  expect(narrow.targetRow?.line).toBeGreaterThan(wide.targetRow?.line ?? 0);
});

test("maps both a deleted row and shared before-side context", async () => {
  const format = (line: number) =>
    formatAndDiff({
      before: "first\nremoved\nlast\n",
      after: "first\nlast\n",
      printWidth: 40,
      filePath: "sample.txt",
      sourceLine: { side: "before", line },
    });
  const removed = await format(2);
  expect(removed.targetRow).toEqual({ side: "before", line: 2 });
  expect(removed.html).toContain('data-review-before="2"');
  expect((await format(3)).targetRow).toEqual({ side: "after", line: 2 });
});

test("maps reflowed comment text and declines rewritten or ambiguous lines", async () => {
  const comment =
    "// A long comment with enough words to wrap across several lines at a narrow width, even without changing its meaning.";
  const before = `${comment}\nrun();\n`;
  const result = await formatAndDiff({
    before,
    after: `${before}added();\n`,
    printWidth: 40,
    filePath: "example.ts",
    sourceLine: { side: "after", line: 1 },
  });
  expect(result.formattedAfter.split("\n").length).toBeGreaterThan(4);
  expect(result.targetRow).toEqual({ side: "after", line: 1 });
  expect(mapSourceLine("removed();\n", "replacement();\n", 1)).toBeUndefined();
  expect(
    mapSourceLine("repeat();\nrepeat();\n", "repeat();\n", 2),
  ).toBeUndefined();
  expect(mapSourceLine("first\n", "first\n", 2)).toBeUndefined();
});
