import { expect, test } from "bun:test";
import { formatCodePreview } from "../src/services/format-code-preview";

test("formats and highlights a file and maps a source citation past reflowed lines", async () => {
  const text =
    '// A long comment that should be split across multiple lines on small screens.\nconst target = "<example>&";\n';
  const { html, targetFound } = await formatCodePreview({
    filePath: "src/example.ts",
    text,
    printWidth: 32,
    sourceLine: 2,
  });
  expect(targetFound).toBe(true);
  expect(html).toContain('class="diff-syntax"');
  const lines = html.split("\n");
  expect(
    lines.findIndex((line) => line.includes(" data-code-target>")),
  ).toBeGreaterThan(1);
  expect(html).toContain("&lt;example&gt;&amp;");
  expect(html).not.toContain("<example>");
});

test("escapes plain text and does not guess at missing source lines", async () => {
  const result = await formatCodePreview({
    filePath: "console.log",
    text: "<div>\r\n\r\n&\n",
    printWidth: 50,
    sourceLine: 4,
  });
  expect(result).toEqual({
    html: '<span data-code-line="1">&lt;div&gt;</span>\n<span data-code-line="2"></span>\n<span data-code-line="3">&amp;</span>\n',
    targetFound: false,
  });
});
