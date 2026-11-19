import { onCleanup } from "solid-js";
import type {
  ViewerContext,
  ViewerSelection,
} from "../../platform/prompt-files";

const MAX_EXCERPT = 8_000;

function readSelection(viewer: ViewerContext): ViewerSelection | undefined {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);
  const kind = "snapshotId" in viewer ? "review" : "file";
  const parent = range.commonAncestorContainer;
  const element = parent instanceof Element ? parent : parent.parentElement;
  const root = element?.closest(`[data-viewer-selection="${kind}"]`);
  if (!root || root.closest("[inert]")) return;

  let text = "";
  let side: ViewerSelection["side"];
  if (kind === "file") text = selection.toString();
  else {
    let deleted = false;
    let added = false;
    const rows: string[] = [];
    for (const code of root.querySelectorAll(".fulltext-line-content code")) {
      if (!range.intersectsNode(code)) continue;
      const part = document.createRange();
      part.selectNodeContents(code);
      if (code.contains(range.startContainer))
        part.setStart(range.startContainer, range.startOffset);
      if (code.contains(range.endContainer))
        part.setEnd(range.endContainer, range.endOffset);
      if (part.collapsed && code.textContent) continue;
      rows.push(part.toString());
      if (code.closest(".fulltext-line-del")) deleted = true;
      if (code.closest(".fulltext-line-add")) added = true;
    }
    text = rows.join("\n");
    if (added !== deleted) side = deleted ? "before" : "after";
  }
  if (!text.trim()) return;
  return {
    viewer,
    text: text.slice(0, MAX_EXCERPT),
    ...(side ? { side } : {}),
    ...(text.length > MAX_EXCERPT ? { truncated: true } : {}),
  };
}

/** Freeze before focus changes; only a composer action can consume the excerpt. */
export function createViewerSelection(viewer: () => ViewerContext | undefined) {
  const read = () => {
    const context = viewer();
    return context ? readSelection(context) : undefined;
  };
  let frozen: ReturnType<typeof read>;
  const clear = () => {
    frozen = undefined;
  };
  const events = ["pointerdown", "pointercancel", "keydown"] as const;
  for (const event of events) document.addEventListener(event, clear, true);
  onCleanup(() => {
    for (const event of events)
      document.removeEventListener(event, clear, true);
  });
  return {
    freeze: () => {
      frozen = read();
    },
    take: () => {
      const live = read();
      const result = frozen?.viewer === viewer() ? frozen : live;
      clear();
      if (result && live) document.getSelection()?.removeAllRanges();
      return result;
    },
  };
}
