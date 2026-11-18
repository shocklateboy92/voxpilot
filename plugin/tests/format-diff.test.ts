import { describe, expect, it } from "bun:test";
import {
  canUseRustfmtOutput,
  formatAndDiff,
} from "../src/services/format-diff";

describe("canUseRustfmtOutput", () => {
  const output = "fn main() {\n  let value = 42;\n}\n";

  it("accepts successful nonblank output", () => {
    const result = { exitCode: 0, signalCode: null };
    expect(canUseRustfmtOutput(result, output)).toBe(true);
  });

  it("accepts nonblank output on exit 1 without interpreting diagnostics", () => {
    const result = { exitCode: 1, signalCode: null };
    expect(canUseRustfmtOutput(result, output)).toBe(true);
  });

  it("rejects blank output even when rustfmt reports success", () => {
    for (const exitCode of [0, 1]) {
      for (const stdout of ["", " ", "\n", " \t\r\n"]) {
        expect(
          canUseRustfmtOutput({ exitCode, signalCode: null }, stdout),
        ).toBe(false);
      }
    }
  });

  it("rejects crashes and other exit codes even with partial output", () => {
    for (const exitCode of [null, 2, 101, 137, 143]) {
      expect(canUseRustfmtOutput({ exitCode, signalCode: null }, output)).toBe(
        false,
      );
    }
    for (const exitCode of [0, 1, null]) {
      expect(
        canUseRustfmtOutput({ exitCode, signalCode: "SIGTERM" }, output),
      ).toBe(false);
    }
  });
});

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

  it("formats Rust snapshots with rustfmt before diffing", async () => {
    const result = await formatAndDiff({
      before: "fn answer()->u32{41}\n",
      after: "fn answer()->u32{42}\n",
      filePath: "src/lib.rs",
      printWidth: 40,
    });

    expect(result.formattedBefore).toBe("fn answer() -> u32 {\n  41\n}\n");
    expect(result.formattedAfter).toBe("fn answer() -> u32 {\n  42\n}\n");
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(result.html).toContain("fulltext-file");
  });

  it("preserves empty Rust input and falls back when rustfmt outputs only whitespace", async () => {
    const whitespace = " \t\n  \n";
    const result = await formatAndDiff({
      before: "",
      after: whitespace,
      filePath: "test.rs",
      printWidth: 40,
    });

    expect(result.formattedBefore).toBe("");
    expect(result.formattedAfter).toBe(whitespace);
  });

  it("uses compact block indentation for Rust at mobile widths", async () => {
    const code =
      "fn main(){some_long_function_name(first_argument, second_argument, third_argument);}\n";
    for (const printWidth of [32, 40, 60]) {
      const result = await formatAndDiff({
        before: "",
        after: code,
        filePath: "test.rs",
        printWidth,
      });

      expect(result.formattedBefore).toBe("");
      expect(result.formattedAfter).toContain("\n    first_argument,");
      for (const line of result.formattedAfter.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(printWidth);
      }
    }

    const wide = await formatAndDiff({
      before: "",
      after: code,
      filePath: "test.rs",
      printWidth: 120,
    });
    expect(wide.formattedAfter).toContain(
      "some_long_function_name(first_argument, second_argument, third_argument);",
    );
  });

  it("parses modern Rust and does not resolve external modules", async () => {
    const result = await formatAndDiff({
      before: "",
      after:
        "mod nonexistent_snapshot_module;\nasync fn load(){let value=fetch().await;}\n",
      filePath: "missing/snapshot.RS",
      printWidth: 40,
    });

    expect(result.formattedAfter).toBe(
      "mod nonexistent_snapshot_module;\nasync fn load() {\n  let value = fetch().await;\n}\n",
    );
  });

  it("does not reorder Rust imports or module declarations", async () => {
    const code = "use z::Z;\nuse a::A;\nmod zebra;\nmod alpha;\n";
    const result = await formatAndDiff({
      before: code,
      after: code,
      filePath: "test.rs",
      printWidth: 40,
    });

    expect(result.formattedAfter).toBe(code);
    expect(result.hunks).toHaveLength(0);
  });

  it("preserves Rust doc comments and raw string contents", async () => {
    const code = [
      "/// Documentation that should remain unchanged even at a narrow width.",
      "fn main() {",
      '  let text = r#"',
      "// This is string data, not a comment that may be reflowed at narrow widths.",
      '"#;',
      "}",
      "",
    ].join("\n");
    const result = await formatAndDiff({
      before: code,
      after: code,
      filePath: "test.rs",
      printWidth: 32,
    });

    expect(result.formattedAfter).toBe(code);
    expect(result.hunks).toHaveLength(0);
  });

  it("falls back to the original Rust when rustfmt cannot parse it", async () => {
    const badRust = "fn broken(\n";
    const result = await formatAndDiff({
      before: "fn answer()->u32{42}\n",
      after: badRust,
      filePath: "test.rs",
      printWidth: 40,
    });

    expect(result.formattedBefore).toBe("fn answer() -> u32 {\n  42\n}\n");
    expect(result.formattedAfter).toBe(badRust);
    expect(result.hunks.length).toBeGreaterThan(0);
  });

  it("keeps Rust formatting when opaque macros retain trailing whitespace", async () => {
    // Like the real multiplexer snapshot, tracing's custom macro syntax cannot
    // be reformatted. rustfmt 1.9 emits the file but reports an internal
    // trailing-whitespace error. Raw-string whitespace must stay untouched.
    const code = [
      "fn main(){",
      'let text = r#"',
      "preserve these trailing spaces   ",
      '"#;',
      "info!(client_id = client_id, unique_name = %unique_name, ",
      ' "registered client");',
      "let answer=41;",
      "}",
      "",
    ].join("\n");
    for (const printWidth of [32, 40, 60]) {
      const result = await formatAndDiff({
        before: code,
        after: code.replace("answer=41", "answer=42"),
        filePath: "multiplexer.rs",
        printWidth,
      });

      expect(result.formattedBefore).toStartWith("fn main() {\n  let text");
      expect(result.formattedBefore).toContain("\n  let answer = 41;\n");
      expect(result.formattedAfter).toContain("\n  let answer = 42;\n");
      expect(result.formattedAfter).toContain(
        'r#"\npreserve these trailing spaces   \n"#',
      );
      expect(result.formattedAfter).toContain(
        "info!(client_id = client_id, unique_name = %unique_name, \n",
      );
      expect(result.hunks.length).toBeGreaterThan(0);
    }
  });

  it("still rejects malformed Rust containing macros with trailing whitespace", async () => {
    const code = [
      "fn main(){",
      "info!(client_id = client_id, unique_name = %unique_name, ",
      ' "registered client");',
      "}",
      "fn broken(",
      "",
    ].join("\n");
    const result = await formatAndDiff({
      before: code,
      after: code,
      filePath: "multiplexer.rs",
      printWidth: 40,
    });

    expect(result.formattedBefore).toBe(code);
    expect(result.formattedAfter).toBe(code);
    expect(result.hunks).toHaveLength(0);
  });

  it("ignores Rust whitespace-only changes after formatting", async () => {
    const result = await formatAndDiff({
      before: "fn answer()->u32{42}\n",
      after: "fn answer() -> u32 {\n    42\n}\n",
      filePath: "test.rs",
      printWidth: 40,
    });

    expect(result.hunks).toHaveLength(0);
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

  it("puts wrapped C++ parameters on separate lines with two-space indentation", async () => {
    const result = await formatAndDiff({
      before: "",
      after:
        "void doSomething(int alpha, int beta, int gamma, int delta, int epsilon) { return; }\n",
      filePath: "test.cpp",
      printWidth: 40,
    });

    expect(result.formattedAfter).toContain(
      "\n  int alpha,\n  int beta,\n  int gamma,\n  int delta,\n  int epsilon\n",
    );
    for (const line of result.formattedAfter.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it("preserves C++ include order and long string literals", async () => {
    const literal =
      '"This string must not be split just to fit the phone screen."';
    const result = await formatAndDiff({
      before: "",
      after: `#include "z.h"\n#include "a.h"\nconst char *text = ${literal};\n`,
      filePath: "test.cpp",
      printWidth: 32,
    });

    expect(result.formattedAfter).toStartWith('#include "z.h"\n#include "a.h"');
    expect(result.formattedAfter).toContain(literal);
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
