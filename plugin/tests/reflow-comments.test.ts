import { describe, expect, it } from "bun:test";
import {
  LANGUAGES,
  languageForFile,
  reflowComments,
} from "../src/services/reflow-comments";

// ---------------------------------------------------------------------------
// languageForFile
// ---------------------------------------------------------------------------

describe("languageForFile", () => {
  it("returns JS language for .js and .jsx", () => {
    expect(languageForFile("app.js")).toEqual(LANGUAGES.js);
    expect(languageForFile("component.jsx")).toEqual(LANGUAGES.js);
  });

  it("returns TS language for .ts and .tsx", () => {
    expect(languageForFile("index.ts")).toEqual(LANGUAGES.ts);
    expect(languageForFile("App.tsx")).toEqual(LANGUAGES.ts);
  });

  it("returns Python language for .py and .pyi", () => {
    expect(languageForFile("main.py")).toEqual(LANGUAGES.python);
    expect(languageForFile("stubs.pyi")).toEqual(LANGUAGES.python);
  });

  it("returns C++ language for C/C++ extensions", () => {
    for (const ext of ["c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"]) {
      expect(languageForFile(`file.${ext}`)).toEqual(LANGUAGES.cpp);
    }
  });

  it("returns undefined for unsupported extensions", () => {
    expect(languageForFile("file.rs")).toBeUndefined();
    expect(languageForFile("file.go")).toBeUndefined();
    expect(languageForFile("file.xyz")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// JS/TS line comments (//)
// ---------------------------------------------------------------------------

describe("reflowComments — JS/TS line comments", () => {
  const lang = LANGUAGES.ts;

  it("wraps a long single-line comment", () => {
    const input =
      "// This is a very long comment that definitely exceeds the print width and should be wrapped to multiple lines\n";
    const result = reflowComments(input, lang, 40);
    const lines = result.split("\n");
    for (const line of lines) {
      if (line.trim() !== "") {
        expect(line.length).toBeLessThanOrEqual(40);
        expect(line).toMatch(/^\/\/ /);
      }
    }
  });

  it("preserves short comments unchanged", () => {
    const input = "// Short comment\nconst x = 1;\n";
    expect(reflowComments(input, lang, 80)).toBe(input);
  });

  it("preserves indentation", () => {
    const input =
      "    // This is a very long comment that definitely exceeds the print width limit\n";
    const result = reflowComments(input, lang, 50);
    const lines = result.split("\n").filter((l) => l.trim() !== "");
    for (const line of lines) {
      expect(line).toMatch(/^ {4}\/\/ /);
      expect(line.length).toBeLessThanOrEqual(50);
    }
  });

  it("reflows a multi-line comment block as a paragraph", () => {
    const input = [
      "// First part of a",
      "// long paragraph that",
      "// spans many lines.",
      "",
    ].join("\n");
    const result = reflowComments(input, lang, 80);
    const commentLines = result.split("\n").filter((l) => l.startsWith("//"));
    // Should be fewer lines when reflowed to 80 chars
    expect(commentLines.length).toBeLessThanOrEqual(2);
    // Should preserve all words
    const allText = commentLines
      .map((l) => l.replace(/^\/\/\s*/, ""))
      .join(" ");
    expect(allText).toContain("First part of a long paragraph");
  });

  it("preserves paragraph breaks in consecutive comments", () => {
    const input = [
      "// First paragraph about something.",
      "//",
      "// Second paragraph about something else.",
      "",
    ].join("\n");
    const result = reflowComments(input, lang, 80);
    expect(result).toContain("//\n");
  });

  it("does not merge code lines between comment blocks", () => {
    const input = ["// Comment one", "const x = 1;", "// Comment two", ""].join(
      "\n",
    );
    const result = reflowComments(input, lang, 80);
    expect(result).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// JS/TS block comments (/* ... */ and /** ... */)
// ---------------------------------------------------------------------------

describe("reflowComments — JS/TS block comments", () => {
  const lang = LANGUAGES.ts;

  it("wraps a long single-line block comment into multi-line", () => {
    const input =
      "/* This is a very long block comment that definitely exceeds the print width and should be wrapped */\n";
    const result = reflowComments(input, lang, 50);
    // Should become multi-line
    expect(result).toContain("/*");
    expect(result).toContain("*/");
    const lines = result.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("preserves short single-line block comments", () => {
    const input = "/* Short comment */\n";
    expect(reflowComments(input, lang, 80)).toBe(input);
  });

  it("reflows multi-line JSDoc comments", () => {
    const input = [
      "/**",
      " * This is a very long JSDoc description that exceeds the print width and should be reflowed to fit within the target width nicely",
      " */",
      "",
    ].join("\n");
    const result = reflowComments(input, lang, 60);
    const bodyLines = result
      .split("\n")
      .filter(
        (l) =>
          l.trim().startsWith("*") && !l.includes("/**") && !l.includes("*/"),
      );
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it("preserves JSDoc tags as separate lines", () => {
    const input = [
      "/**",
      " * Description of the function.",
      " * @param x The first parameter",
      " * @param y The second parameter",
      " * @returns The result",
      " */",
      "",
    ].join("\n");
    const result = reflowComments(input, lang, 80);
    expect(result).toContain("@param x");
    expect(result).toContain("@param y");
    expect(result).toContain("@returns");
  });

  it("preserves indented block comments", () => {
    const input = ["  /**", "   * Indented JSDoc comment.", "   */", ""].join(
      "\n",
    );
    const result = reflowComments(input, lang, 80);
    expect(result).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Python # comments
// ---------------------------------------------------------------------------

describe("reflowComments — Python # comments", () => {
  const lang = LANGUAGES.python;

  it("wraps a long single-line hash comment", () => {
    const input =
      "# This is a very long Python comment that definitely exceeds the print width and should be wrapped to multiple lines\n";
    const result = reflowComments(input, lang, 40);
    const lines = result.split("\n").filter((l) => l.trim() !== "");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(40);
      expect(line).toMatch(/^# /);
    }
  });

  it("preserves short hash comments", () => {
    const input = "# Short comment\nx = 1\n";
    expect(reflowComments(input, lang, 80)).toBe(input);
  });

  it("preserves indented hash comments", () => {
    const input =
      "    # This is a very long indented Python comment that exceeds the print width limit we set\n";
    const result = reflowComments(input, lang, 50);
    const lines = result.split("\n").filter((l) => l.trim() !== "");
    for (const line of lines) {
      expect(line).toMatch(/^ {4}# /);
      expect(line.length).toBeLessThanOrEqual(50);
    }
  });
});

// ---------------------------------------------------------------------------
// Python docstrings
// ---------------------------------------------------------------------------

describe("reflowComments — Python docstrings", () => {
  const lang = LANGUAGES.python;

  it("wraps a long single-line docstring into multi-line", () => {
    const input =
      '    """This is a very long docstring that definitely exceeds the print width and should be wrapped to multiple lines for readability."""\n';
    const result = reflowComments(input, lang, 50);
    expect(result).toContain('"""');
    const lines = result.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("preserves short single-line docstrings", () => {
    const input = '    """Short docstring."""\n';
    expect(reflowComments(input, lang, 80)).toBe(input);
  });

  it("reflows multi-line docstrings", () => {
    const input = [
      '    """',
      "    This is a very long docstring description that exceeds the print width and should be reflowed to fit within the target width nicely.",
      '    """',
      "",
    ].join("\n");
    const result = reflowComments(input, lang, 50);
    const bodyLines = result
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.trim().startsWith('"""'));
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(50);
    }
  });

  it("preserves reStructuredText params in docstrings", () => {
    const input = [
      '    """',
      "    Description of the function.",
      "",
      "    :param x: The first parameter",
      "    :param y: The second parameter",
      "    :returns: The result",
      '    """',
      "",
    ].join("\n");
    const result = reflowComments(input, lang, 80);
    expect(result).toContain(":param x:");
    expect(result).toContain(":param y:");
    expect(result).toContain(":returns:");
  });
});

// ---------------------------------------------------------------------------
// C++ comments
// ---------------------------------------------------------------------------

describe("reflowComments — C++ comments", () => {
  const lang = LANGUAGES.cpp;

  it("wraps long C++ line comments", () => {
    const input =
      "// This is a very long C++ comment that definitely exceeds the print width and should be wrapped to multiple lines\n";
    const result = reflowComments(input, lang, 50);
    const lines = result.split("\n").filter((l) => l.trim() !== "");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(50);
      expect(line).toMatch(/^\/\/ /);
    }
  });

  it("wraps long C++ block comments", () => {
    const input =
      "/* This is a very long C++ block comment that definitely exceeds the print width and should be wrapped to multiple lines */\n";
    const result = reflowComments(input, lang, 50);
    expect(result).toContain("/*");
    expect(result).toContain("*/");
    const lines = result.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("preserves Doxygen tags", () => {
    const input = [
      "/**",
      " * Description of the function.",
      " * @param x The first parameter",
      " * @param y The second parameter",
      " * @return The result",
      " */",
      "",
    ].join("\n");
    const result = reflowComments(input, lang, 80);
    expect(result).toContain("@param x");
    expect(result).toContain("@param y");
    expect(result).toContain("@return");
  });
});

// ---------------------------------------------------------------------------
// Skip heuristics
// ---------------------------------------------------------------------------

describe("reflowComments — skip heuristics", () => {
  const tsLang = LANGUAGES.ts;
  const pyLang = LANGUAGES.python;

  it("does not reflow @ts-ignore directives", () => {
    const input =
      "// @ts-ignore some very long explanation that exceeds width\n";
    expect(reflowComments(input, tsLang, 30)).toBe(input);
  });

  it("does not reflow eslint directives", () => {
    const input =
      "// eslint-disable-next-line no-unused-vars, @typescript-eslint/no-explicit-any\n";
    expect(reflowComments(input, tsLang, 40)).toBe(input);
  });

  it("does not reflow Python noqa comments", () => {
    const input = "# noqa: E501 very long line that we intentionally allow\n";
    expect(reflowComments(input, pyLang, 30)).toBe(input);
  });

  it("does not reflow fmt: off/on comments", () => {
    const input = "# fmt: off\n";
    expect(reflowComments(input, pyLang, 30)).toBe(input);
  });

  it("does not reflow type: ignore comments", () => {
    const input = "# type: ignore[assignment] some long explanation here\n";
    expect(reflowComments(input, pyLang, 30)).toBe(input);
  });

  it("does not reflow NOLINT comments in C++", () => {
    const input =
      "// NOLINT(readability-function-size) very long explanation\n";
    const cppLang = LANGUAGES.cpp;
    expect(reflowComments(input, cppLang, 30)).toBe(input);
  });

  it("preserves markdown list items inside comments", () => {
    const input = [
      "// Things to do:",
      "// - First item that is important",
      "// - Second item that is important",
      "// - Third item that is important",
      "",
    ].join("\n");
    const result = reflowComments(input, tsLang, 80);
    expect(result).toContain("// - First item");
    expect(result).toContain("// - Second item");
    expect(result).toContain("// - Third item");
  });

  it("preserves code blocks inside block comments", () => {
    const input = [
      "/**",
      " * Usage example:",
      " *",
      " * ```ts",
      " * const x = foo(1, 2, 3);",
      " * const y = bar(x);",
      " * ```",
      " */",
      "",
    ].join("\n");
    const result = reflowComments(input, tsLang, 40);
    expect(result).toContain("```ts");
    expect(result).toContain("const x = foo(1, 2, 3);");
    expect(result).toContain("const y = bar(x);");
    expect(result).toContain("```");
  });

  it("does not break lines with long URLs", () => {
    const input =
      "// See https://very-long-domain.example.com/path/to/some/resource/with/many/segments?param=value\n";
    const result = reflowComments(input, tsLang, 40);
    // The URL should remain intact on one line
    expect(result).toContain(
      "https://very-long-domain.example.com/path/to/some/resource/with/many/segments?param=value",
    );
  });

  it("preserves numbered list items", () => {
    const input = [
      "// Steps:",
      "// 1. Do the first thing",
      "// 2. Do the second thing",
      "// 3. Do the third thing",
      "",
    ].join("\n");
    const result = reflowComments(input, tsLang, 80);
    expect(result).toContain("// 1. Do the first thing");
    expect(result).toContain("// 2. Do the second thing");
    expect(result).toContain("// 3. Do the third thing");
  });

  it("stops collecting comment block at directive line", () => {
    const input = [
      "// Normal comment",
      "// @ts-ignore",
      "const x = 1;",
      "",
    ].join("\n");
    const result = reflowComments(input, tsLang, 80);
    expect(result).toContain("// @ts-ignore");
    expect(result).toContain("const x = 1;");
  });

  it("truncates dash separator lines to fit printWidth", () => {
    const input =
      "// ---------------------------------------------------------------------------\n";
    const result = reflowComments(input, tsLang, 40);
    expect(result.trimEnd()).toBe("// -------------------------------------");
  });

  it("truncates equals separator lines to fit printWidth", () => {
    const input =
      "// ===================================================================\n";
    const result = reflowComments(input, tsLang, 40);
    expect(result.trimEnd()).toBe("// =====================================");
  });

  it("truncates separators inside a multi-line comment block", () => {
    const input = [
      "// ---------------------------------------------------------------------------",
      "// Section heading",
      "// ---------------------------------------------------------------------------",
      "",
    ].join("\n");
    const result = reflowComments(input, tsLang, 40);
    const lines = result.split("\n").filter((l) => l.trim() !== "");
    expect(lines[0]).toBe("// -------------------------------------");
    expect(lines[1]).toContain("Section heading");
    expect(lines[2]).toBe("// -------------------------------------");
  });

  it("truncates Python hash separator lines", () => {
    const input =
      "# ---------------------------------------------------------------------------\n";
    const result = reflowComments(input, pyLang, 40);
    expect(result.trimEnd()).toBe("# --------------------------------------");
  });

  it("normalizes short separator lines to fill printWidth", () => {
    const input = "// -----\n";
    const result = reflowComments(input, tsLang, 20);
    // Short separator gets expanded to fill printWidth
    expect(result.trimEnd()).toBe("// -----------------");
  });
});

// ---------------------------------------------------------------------------
// Integration: non-comment code should be untouched
// ---------------------------------------------------------------------------

describe("reflowComments — code preservation", () => {
  const lang = LANGUAGES.ts;

  it("does not modify non-comment code", () => {
    const input = [
      "const x = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };",
      'const s = "this is a very long string that exceeds the width";',
      "function foo(alpha: number, beta: number, gamma: number): number {",
      "  return alpha + beta + gamma;",
      "}",
      "",
    ].join("\n");
    expect(reflowComments(input, lang, 40)).toBe(input);
  });

  it("handles mixed code and comments", () => {
    const input = [
      "// This is a very long comment that should be reflowed to fit the width",
      "const x = 1;",
      "// Another comment",
      "const y = 2;",
      "",
    ].join("\n");
    const result = reflowComments(input, lang, 40);
    expect(result).toContain("const x = 1;");
    expect(result).toContain("const y = 2;");
    // The long comment should be wrapped
    const commentLines = result.split("\n").filter((l) => l.startsWith("//"));
    for (const line of commentLines) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it("handles empty input", () => {
    expect(reflowComments("", LANGUAGES.ts, 80)).toBe("");
  });

  it("handles input with no comments", () => {
    const input = "const x = 1;\nconst y = 2;\n";
    expect(reflowComments(input, LANGUAGES.ts, 80)).toBe(input);
  });
});
