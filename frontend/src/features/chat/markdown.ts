import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, typographer: true, linkify: true });

/*
 * Wrap code blocks and tables in a `.scroll-wrapper` so they can be
 * scrolled horizontally without widening the chat view.  The wrapper
 * also gets its own touch handling (see MessageBubble) to avoid
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

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return md.render(text);
}
