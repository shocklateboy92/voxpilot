// Mermaid has global configuration and uses temporary DOM nodes while rendering.
// Serialize initialization/rendering across all Markdown views.
let pending = Promise.resolve();
let nextId = 0;
const sources = new WeakMap<HTMLElement, string>();

export function renderMermaid(
  root: HTMLElement,
  light: boolean,
  current: () => boolean,
): Promise<void> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>("[data-mermaid]"),
  );
  if (blocks.length === 0) return Promise.resolve();

  const render = async () => {
    if (!current()) return;
    const { default: mermaid } = await import("mermaid");
    if (!current()) return;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: light ? "default" : "dark",
      suppressErrorRendering: true,
      // Avoid HTML labels inheriting Markdown typography and link behavior.
      htmlLabels: false,
      secure: [
        ...(mermaid.mermaidAPI.defaultConfig.secure ?? []),
        "htmlLabels",
        "theme",
        "themeVariables",
      ],
    });
    for (const block of blocks) {
      if (!current()) return;
      const source =
        sources.get(block) ?? block.querySelector("code")?.textContent;
      if (source === undefined || source === null) continue;
      sources.set(block, source);
      const host = document.createElement("div");
      host.className = "mermaid-render-host";
      document.body.append(host);
      try {
        const { svg } = await mermaid.render(
          `mermaid-${++nextId}`,
          source,
          host,
        );
        if (!current()) return;
        block.innerHTML = svg;
        block.classList.add("mermaid-diagram");
      } catch {
        // Invalid/incomplete streaming diagrams remain ordinary escaped code.
      } finally {
        host.remove();
      }
    }
  };
  // A failed import must not prevent later views from retrying.
  pending = pending.then(render).catch(() => {});
  return pending;
}
