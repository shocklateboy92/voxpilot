import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, typographer: true, linkify: true });

/**
 * Wrap block-level elements that may overflow horizontally in a
 * scroll container so they can be scrolled independently of the
 * chat view.  The `.scroll-wrapper` div gets its own touch handling
 * (see MessageBubble) to avoid conflicting with swipe gestures.
 */
function wrapScrollableBlocks(html: string): string {
  return html
    .replace(/<pre>/g, '<div class="scroll-wrapper"><pre>')
    .replace(/<\/pre>/g, "</pre></div>")
    .replace(/<table>/g, '<div class="scroll-wrapper"><table>')
    .replace(/<\/table>/g, "</table></div>");
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return wrapScrollableBlocks(md.render(text));
}
