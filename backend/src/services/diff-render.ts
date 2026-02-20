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

/**
 * Render a full file with diff lines highlighted.
 *
 * Takes the full post-change file content and the parsed hunks,
 * uses the `fullTextLine` mapping to highlight additions, and
 * interleaves deleted lines at the correct positions so the user
 * can see what was removed without leaving the full-file view.
 *
 * @param fileId - Stable file ID for data attributes.
 * @param path - File path for display.
 * @param fullTextContent - Full post-change file content.
 * @param hunks - Parsed diff hunks (used to identify changes).
 * @returns HTML string for the full-file view with diff highlighting.
 */
export function renderFullFileHtml(
  fileId: string,
  path: string,
  fullTextContent: string,
  hunks: DiffHunk[],
): string {
  // Build set of 1-based line numbers that are additions
  const addedLines = new Set<number>();

  // Build map: "insert these deleted lines BEFORE fullTextLine N"
  const deletionsBefore = new Map<number, DiffLine[]>();

  for (const hunk of hunks) {
    const pendingDels: DiffLine[] = [];

    for (const line of hunk.lines) {
      if (line.kind === "del") {
        pendingDels.push(line);
      } else {
        // context or add — flush any pending deletions before this line
        if (pendingDels.length > 0 && line.fullTextLine != null) {
          const existing = deletionsBefore.get(line.fullTextLine) ?? [];
          deletionsBefore.set(line.fullTextLine, [...existing, ...pendingDels]);
          pendingDels.length = 0;
        }
        if (line.kind === "add" && line.fullTextLine != null) {
          addedLines.add(line.fullTextLine);
        }
      }
    }

    // Trailing deletions at end of hunk (no subsequent context/add)
    if (pendingDels.length > 0) {
      let lastFullTextLine = 0;
      for (const line of hunk.lines) {
        if (line.kind !== "del" && line.fullTextLine != null) {
          lastFullTextLine = line.fullTextLine;
        }
      }
      // If no non-del line in the hunk, use the hunk's newStart position
      const key = lastFullTextLine > 0
        ? lastFullTextLine + 1
        : Math.max(1, hunk.newStart + 1);
      const existing = deletionsBefore.get(key) ?? [];
      deletionsBefore.set(key, [...existing, ...pendingDels]);
    }
  }

  const lines = fullTextContent.split("\n");
  const parts: string[] = [];

  parts.push(`<div class="fulltext-file" data-file-id="${escapeHtml(fileId)}">`);
  parts.push('<table class="fulltext-table">');

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;

    // Insert deleted lines that belong before this line
    const dels = deletionsBefore.get(lineNum);
    if (dels) {
      for (const del of dels) {
        parts.push(
          `<tr class="fulltext-line fulltext-line-del">` +
          `<td class="fulltext-line-num"></td>` +
          `<td class="fulltext-line-content"><code>${escapeHtml(del.content)}</code></td>` +
          `</tr>`,
        );
      }
    }

    const isAdded = addedLines.has(lineNum);
    const rowClass = isAdded ? "fulltext-line fulltext-line-add" : "fulltext-line";

    parts.push(
      `<tr class="${rowClass}">` +
      `<td class="fulltext-line-num">${lineNum}</td>` +
      `<td class="fulltext-line-content"><code>${escapeHtml(lines[i] ?? "")}</code></td>` +
      `</tr>`,
    );
  }

  // Trailing deletions after the last line
  const trailingKey = lines.length + 1;
  const trailingDels = deletionsBefore.get(trailingKey);
  if (trailingDels) {
    for (const del of trailingDels) {
      parts.push(
        `<tr class="fulltext-line fulltext-line-del">` +
        `<td class="fulltext-line-num"></td>` +
        `<td class="fulltext-line-content"><code>${escapeHtml(del.content)}</code></td>` +
        `</tr>`,
      );
    }
  }

  parts.push("</table>");
  parts.push("</div>");

  return parts.join("\n");
}
