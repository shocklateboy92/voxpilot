import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, typographer: true, linkify: true });

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return md.render(text);
}
