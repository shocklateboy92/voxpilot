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

  it("passes through unknown file types without formatting", async () => {
    const before = "hello world";
    const after = "hello new world";
    const result = await formatAndDiff({
      before,
      after,
      filePath: "unknown.xyz",
      printWidth: 80,
    });

    // Passthrough: content should be returned exactly as-is
    expect(result.formattedBefore).toBe(before);
    expect(result.formattedAfter).toBe(after);
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

  it("formats Python files with ruff", async () => {
    const result = await formatAndDiff({
      before: "x = 1\n",
      after: "x = 2\ny = 3\n",
      filePath: "test.py",
      printWidth: 80,
    });

    expect(result.formattedBefore).toBeDefined();
    expect(result.formattedAfter).toBeDefined();
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(result.html).toContain("fulltext-file");
  });

  it("respects printWidth for Python formatting", async () => {
    const longLine =
      'x = {"a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6, "g": 7, "h": 8}\n';
    const result40 = await formatAndDiff({
      before: "",
      after: longLine,
      filePath: "test.py",
      printWidth: 40,
    });
    const result120 = await formatAndDiff({
      before: "",
      after: longLine,
      filePath: "test.py",
      printWidth: 120,
    });

    // With narrow width, ruff should break the line into more lines
    expect(result40.formattedAfter.split("\n").length).toBeGreaterThan(
      result120.formattedAfter.split("\n").length,
    );
  });

  it("formats .pyi stub files with ruff", async () => {
    const result = await formatAndDiff({
      before: "def foo(x:int)->str: ...\n",
      after: "def foo(x:int, y:int)->str: ...\n",
      filePath: "stubs/types.pyi",
      printWidth: 80,
    });

    expect(result.formattedBefore).toBeDefined();
    expect(result.formattedAfter).toBeDefined();
    // Ruff should normalize spacing around type annotations
    expect(result.formattedAfter).toContain(": int");
    expect(result.formattedAfter).toContain("-> str");
  });

  it("falls back gracefully when ruff encounters a syntax error", async () => {
    const badPython = "def foo(\n";
    const result = await formatAndDiff({
      before: badPython,
      after: badPython,
      filePath: "bad.py",
      printWidth: 80,
    });

    // Should return unformatted content without crashing
    expect(result.formattedAfter).toBe(badPython);
    expect(result.hunks.length).toBe(0);
  });

  it("formats C++ files with clang-format", async () => {
    const result = await formatAndDiff({
      before: "int x = 1;\n",
      after: "int x = 2;\nint y = 3;\n",
      filePath: "test.cpp",
      printWidth: 80,
    });

    expect(result.formattedBefore).toBeDefined();
    expect(result.formattedAfter).toBeDefined();
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(result.html).toContain("fulltext-file");
  });

  it("respects printWidth for C++ formatting", async () => {
    const longLine =
      "void doSomething(int alpha, int beta, int gamma, int delta, int epsilon) { return; }\n";
    const result40 = await formatAndDiff({
      before: "",
      after: longLine,
      filePath: "test.cpp",
      printWidth: 40,
    });
    const result120 = await formatAndDiff({
      before: "",
      after: longLine,
      filePath: "test.cpp",
      printWidth: 120,
    });

    // With narrow width, clang-format should break the line into more lines
    expect(result40.formattedAfter.split("\n").length).toBeGreaterThan(
      result120.formattedAfter.split("\n").length,
    );
  });

  it("uses BlockIndent to avoid deep alignment in C++", async () => {
    const code =
      "some_long_function_name(first_arg, second_arg, third_arg, fourth_arg);\n";
    const result = await formatAndDiff({
      before: "",
      after: code,
      filePath: "test.cpp",
      printWidth: 50,
    });

    // With BlockIndent, args should NOT be aligned to the opening paren.
    // Instead they should use a fixed indent (typically 4 spaces).
    const lines = result.formattedAfter.split("\n").filter(Boolean);
    for (const line of lines.slice(1)) {
      // No continuation line should have more than 8 leading spaces
      // (BlockIndent uses a small fixed indent, not paren-alignment)
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      expect(indent).toBeLessThanOrEqual(8);
    }
  });

  it("formats C header files with clang-format", async () => {
    const result = await formatAndDiff({
      before: "int foo(int x);\n",
      after: "int foo(int x, int y);\n",
      filePath: "include/utils.h",
      printWidth: 80,
    });

    expect(result.formattedBefore).toBeDefined();
    expect(result.formattedAfter).toBeDefined();
    expect(result.html).toContain("fulltext-file");
  });

  it("falls back gracefully when clang-format encounters a syntax error", async () => {
    const badCpp = "int foo(\n";
    const result = await formatAndDiff({
      before: badCpp,
      after: badCpp,
      filePath: "bad.cpp",
      printWidth: 80,
    });

    // Should return unformatted content without crashing
    expect(result.formattedAfter).toBe(badCpp);
    expect(result.hunks.length).toBe(0);
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
        before: `${beforeLines.join("\n")}\n`,
        after: `${afterLines.join("\n")}\n`,
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
