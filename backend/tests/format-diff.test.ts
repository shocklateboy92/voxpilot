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
});
