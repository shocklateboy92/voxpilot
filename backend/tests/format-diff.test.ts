import { describe, expect, it } from "bun:test";
import { formatAndDiff } from "../src/services/format-diff";

describe("formatAndDiff", () => {
  it("returns formatted diff for TypeScript file", async () => {
    const result = await formatAndDiff({
      before: "const x = 1;\n",
      after: "const x = 2;\nconst y = 3;\n",
      filePath: "test.ts",
      printWidth: 80,
    });

    expect(result.formattedBefore).toBeDefined();
    expect(result.formattedAfter).toBeDefined();
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(result.html).toContain("fulltext-file");
  });

  it("handles identical files with empty hunks", async () => {
    const result = await formatAndDiff({
      before: "const x = 1;\n",
      after: "const x = 1;\n",
      filePath: "test.ts",
      printWidth: 80,
    });

    expect(result.hunks.length).toBe(0);
  });

  it("falls back gracefully for unknown file types", async () => {
    const result = await formatAndDiff({
      before: "hello world",
      after: "hello new world",
      filePath: "unknown.xyz",
      printWidth: 80,
    });

    expect(result.html).toContain("fulltext-file");
  });

  it("respects printWidth for formatting", async () => {
    const longLine =
      "const x = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };\n";
    const result40 = await formatAndDiff({
      before: "",
      after: longLine,
      filePath: "test.ts",
      printWidth: 40,
    });
    const result120 = await formatAndDiff({
      before: "",
      after: longLine,
      filePath: "test.ts",
      printWidth: 120,
    });

    // With narrow width, prettier should break the line into more lines
    expect(result40.formattedAfter.split("\n").length).toBeGreaterThanOrEqual(
      result120.formattedAfter.split("\n").length,
    );
  });

  it("fullTextLine matches actual line in formatted output for small context gaps", async () => {
    // Regression: when two changes are separated by 4-6 context lines,
    // the second change's fullTextLine was miscalculated, causing
    // red/green highlights to land on the wrong lines.
    for (const gapSize of [1, 4, 5, 6, 7, 10]) {
      const beforeLines: string[] = [];
      const afterLines: string[] = [];

      for (let i = 1; i <= 4; i++) {
        beforeLines.push(`const v${i} = ${i};`);
        afterLines.push(`const v${i} = ${i};`);
      }
      beforeLines.push("const OLD_A = 0;");
      afterLines.push("const NEW_A = 0;");
      for (let i = 6; i <= 5 + gapSize; i++) {
        beforeLines.push(`const v${i} = ${i};`);
        afterLines.push(`const v${i} = ${i};`);
      }
      beforeLines.push("const OLD_B = 0;");
      afterLines.push("const NEW_B = 0;");
      for (let i = 5 + gapSize + 2; i <= 5 + gapSize + 5; i++) {
        beforeLines.push(`const v${i} = ${i};`);
        afterLines.push(`const v${i} = ${i};`);
      }

      const result = await formatAndDiff({
        before: beforeLines.join("\n") + "\n",
        after: afterLines.join("\n") + "\n",
        filePath: "test.ts",
        printWidth: 80,
      });

      const formattedLines = result.formattedAfter.split("\n");
      for (const hunk of result.hunks) {
        for (const line of hunk.lines) {
          if (line.fullTextLine != null) {
            expect(formattedLines[line.fullTextLine - 1]).toBe(line.content);
          }
        }
      }
    }
  });
});
