import { describe, expect, it } from "bun:test";
import { renderDiffFileHtml } from "../src/services/diff-render";
import type { DiffHunk } from "../src/schemas/diff-document";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    id: "h-0",
    header: "@@ -1,3 +1,4 @@",
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 4,
    lines: [
      {
        id: "h-0-L0",
        kind: "context",
        oldLine: 1,
        newLine: 1,
        content: "first",
        fullTextLine: 1,
      },
      {
        id: "h-0-L1",
        kind: "del",
        oldLine: 2,
        newLine: null,
        content: "old line",
        fullTextLine: null,
      },
      {
        id: "h-0-L2",
        kind: "add",
        oldLine: null,
        newLine: 2,
        content: "new line",
        fullTextLine: 2,
      },
      {
        id: "h-0-L3",
        kind: "add",
        oldLine: null,
        newLine: 3,
        content: "extra line",
        fullTextLine: 3,
      },
      {
        id: "h-0-L4",
        kind: "context",
        oldLine: 3,
        newLine: 4,
        content: "last",
        fullTextLine: 4,
      },
    ],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("renderDiffFileHtml", () => {
  it("returns an HTML string", () => {
    const html = renderDiffFileHtml("f-abc", "src/main.ts", [makeHunk()]);
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("wraps output in diff-file div with data-file-id", () => {
    const html = renderDiffFileHtml("f-xyz", "path.ts", [makeHunk()]);
    expect(html).toContain('class="diff-file"');
    expect(html).toContain('data-file-id="f-xyz"');
  });

  it("includes file header with escaped path", () => {
    const html = renderDiffFileHtml("f-1", "src/<special>.ts", [makeHunk()]);
    expect(html).toContain("src/&lt;special&gt;.ts");
  });

  it("renders hunk header", () => {
    const html = renderDiffFileHtml("f-1", "a.ts", [makeHunk()]);
    expect(html).toContain('class="diff-hunk-header"');
    expect(html).toContain("@@ -1,3 +1,4 @@");
  });

  it("renders a diff table", () => {
    const html = renderDiffFileHtml("f-1", "a.ts", [makeHunk()]);
    expect(html).toContain('<table class="diff-table">');
    expect(html).toContain("</table>");
  });

  it("renders context lines with correct class and prefix", () => {
    const html = renderDiffFileHtml("f-1", "a.ts", [makeHunk()]);
    expect(html).toContain('class="diff-line diff-line-context"');
    // Context line should have space prefix
    expect(html).toContain('<td class="diff-line-prefix"> </td>');
  });

  it("renders add lines with + prefix", () => {
    const html = renderDiffFileHtml("f-1", "a.ts", [makeHunk()]);
    expect(html).toContain('class="diff-line diff-line-add"');
    expect(html).toContain('<td class="diff-line-prefix">+</td>');
  });

  it("renders del lines with - prefix", () => {
    const html = renderDiffFileHtml("f-1", "a.ts", [makeHunk()]);
    expect(html).toContain('class="diff-line diff-line-del"');
    expect(html).toContain('<td class="diff-line-prefix">-</td>');
  });

  it("includes data-line-id on each row", () => {
    const html = renderDiffFileHtml("f-1", "a.ts", [makeHunk()]);
    expect(html).toContain('data-line-id="h-0-L0"');
    expect(html).toContain('data-line-id="h-0-L1"');
    expect(html).toContain('data-line-id="h-0-L2"');
  });

  it("includes old and new line numbers", () => {
    const html = renderDiffFileHtml("f-1", "a.ts", [makeHunk()]);
    // Del line: old=2, new=empty
    expect(html).toContain(
      '<td class="diff-line-num diff-line-old">2</td>' +
        '<td class="diff-line-num diff-line-new"></td>',
    );
    // Add line: old=empty, new=2
    expect(html).toContain(
      '<td class="diff-line-num diff-line-old"></td>' +
        '<td class="diff-line-num diff-line-new">2</td>',
    );
  });

  it("wraps content in <code>", () => {
    const html = renderDiffFileHtml("f-1", "a.ts", [makeHunk()]);
    expect(html).toContain("<code>first</code>");
    expect(html).toContain("<code>old line</code>");
  });

  it("escapes HTML in content", () => {
    const hunk = makeHunk({
      lines: [
        {
          id: "h-0-L0",
          kind: "add",
          oldLine: null,
          newLine: 1,
          content: 'const x = a < b && c > d; "ok"',
          fullTextLine: 1,
        },
      ],
    });
    const html = renderDiffFileHtml("f-1", "a.ts", [hunk]);
    expect(html).toContain("a &lt; b &amp;&amp; c &gt; d; &quot;ok&quot;");
    // No raw < > & "
    expect(html).not.toContain('"ok"</code>');
  });

  it("renders empty hunks without errors", () => {
    const html = renderDiffFileHtml("f-1", "a.ts", []);
    expect(html).toContain('class="diff-file"');
    expect(html).not.toContain("diff-table");
  });

  it("renders multiple hunks", () => {
    const hunk1 = makeHunk({ id: "h-0", header: "@@ -1,3 +1,3 @@" });
    const hunk2 = makeHunk({ id: "h-1", header: "@@ -10,3 +10,3 @@" });
    const html = renderDiffFileHtml("f-1", "a.ts", [hunk1, hunk2]);
    expect(html).toContain('data-hunk-id="h-0"');
    expect(html).toContain('data-hunk-id="h-1"');
  });
});
