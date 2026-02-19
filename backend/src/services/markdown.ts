import MarkdownIt from "markdown-it";
import type { RenderRule } from "markdown-it/lib/renderer.mjs";

const md = new MarkdownIt("commonmark", { html: false, typographer: true });
md.enable("table");

export type { RenderRule };

export function getRenderer(): MarkdownIt {
  return md;
}

export function setFenceRenderer(rule: RenderRule): void {
  md.renderer.rules.fence = rule;
}

export function setRenderRule(name: string, rule: RenderRule): void {
  md.renderer.rules[name] = rule;
}

export function renderMarkdown(text: string): string {
  if (!text || !text.trim()) {
    return "";
  }
  return md.render(text);
}
