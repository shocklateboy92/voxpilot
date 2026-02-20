/**
 * Diff HTML renderer.
 *
 * Walks the parsed DiffFile model and emits one sanitized HTML fragment
 * per file with stable `data-line-id` / `data-file-id` attributes and
 * CSS classes per line kind (add / del / context).
 *
 * Each file gets its own `html` string — the frontend carousel maps
 * 1:1 (page N = files[N].html).
 */

import type { DiffHunk, DiffLine } from "../schemas/diff-document";

/** Escape HTML special characters. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a single file's diff hunks to an HTML fragment.
 *
 * @param fileId - Stable file ID for data attributes.
 * @param path - File path for display.
 * @param hunks - Parsed diff hunks.
 * @returns HTML string for the file's diff view.
 */
export function renderDiffFileHtml(
  fileId: string,
  path: string,
  hunks: DiffHunk[],
): string {
  const parts: string[] = [];

  parts.push(`<div class="diff-file" data-file-id="${escapeHtml(fileId)}">`);
  parts.push(
    `<div class="diff-file-header">${escapeHtml(path)}</div>`,
  );

  for (const hunk of hunks) {
    parts.push(`<div class="diff-hunk" data-hunk-id="${escapeHtml(hunk.id)}">`);
    parts.push(
      `<div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>`,
    );
    parts.push('<table class="diff-table">');

    for (const line of hunk.lines) {
      parts.push(renderDiffLine(line));
    }

    parts.push("</table>");
    parts.push("</div>"); // diff-hunk
  }

  parts.push("</div>"); // diff-file

  return parts.join("\n");
}

function renderDiffLine(line: DiffLine): string {
  const kindClass = `diff-line-${line.kind}`;
  const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  const oldNum = line.oldLine !== null ? String(line.oldLine) : "";
  const newNum = line.newLine !== null ? String(line.newLine) : "";

  return (
    `<tr class="diff-line ${kindClass}" data-line-id="${escapeHtml(line.id)}">` +
    `<td class="diff-line-num diff-line-old">${oldNum}</td>` +
    `<td class="diff-line-num diff-line-new">${newNum}</td>` +
    `<td class="diff-line-prefix">${prefix}</td>` +
    `<td class="diff-line-content"><code>${escapeHtml(line.content)}</code></td>` +
    `</tr>`
  );
}
