import MarkdownIt from "markdown-it";

// Shared by chat messages and the file viewer.

const md = new MarkdownIt({ html: false, typographer: true, linkify: true });

/*
 * Wrap code blocks and tables in a `.scroll-wrapper` so they can be
 * scrolled horizontally without widening the chat view.  The wrapper
 * also gets its own touch handling (see MarkdownView) to avoid
 * conflicting with swipe gestures.
 */

const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const inner = defaultFence
    ? defaultFence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
  return `<div class="scroll-wrapper">${inner}</div>`;
};

const defaultCodeBlock = md.renderer.rules.code_block;
md.renderer.rules.code_block = (tokens, idx, options, env, self) => {
  const inner = defaultCodeBlock
    ? defaultCodeBlock(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
  return `<div class="scroll-wrapper">${inner}</div>`;
};

md.renderer.rules.table_open = () => '<div class="scroll-wrapper"><table>';
md.renderer.rules.table_close = () => "</table></div>";

export function renderMarkdown(
  text: string,
  resolveLink?: (href: string) => string | undefined,
): string {
  if (!text) return "";
  const tokens = md.parse(text, {});
  const headingCounts = new Map<string, number>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token?.type !== "heading_open") continue;
    const title = (tokens[index + 1]?.children ?? [])
      .filter((child) => child.type === "text" || child.type === "code_inline")
      .map((child) => child.content)
      .join("");
    const slug = title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    const count = headingCounts.get(slug) ?? 0;
    headingCounts.set(slug, count + 1);
    token.attrSet("id", count === 0 ? slug : `${slug}-${count}`);
  }
  function rewriteLinks(items: typeof tokens): void {
    for (const token of items) {
      if (token.type === "link_open") {
        const href = token.attrGet("href");
        const resolved = href === null ? undefined : resolveLink?.(href);
        if (resolved !== undefined) token.attrSet("href", resolved);
      }
      if (token.children) rewriteLinks(token.children);
    }
  }
  if (resolveLink) rewriteLinks(tokens);
  return md.renderer.render(tokens, md.options, {});
}
