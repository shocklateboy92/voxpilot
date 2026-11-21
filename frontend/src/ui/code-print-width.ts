import { MAX_PRINT_WIDTH } from "@plugin/rpc";

/** Typical monospace advance at the default code size, if canvas is unavailable. */
const FALLBACK_CHAR_WIDTH = 7.2;
/** Review diffs stay readable by scrolling rather than wrapping below this. */
const DEFAULT_MIN_COLUMNS = 40;

let measureContext: CanvasRenderingContext2D | null | undefined;

function cssToPx(value: string, rootFontSize: number): number {
  const num = parseFloat(value);
  return value.endsWith("rem") ? num * rootFontSize : num;
}

/** Use the same font and spacing as the rendered code. */
function computePrintWidth(container: HTMLElement, minColumns: number): number {
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;" +
    "font-family:var(--font-mono);font-size:var(--code-font-size);";
  container.appendChild(probe);
  const font = getComputedStyle(probe);
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (measureContext)
    measureContext.font = `${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
  probe.remove();
  const charWidth =
    measureContext?.measureText("0").width || FALLBACK_CHAR_WIDTH;

  const rootFontSize = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  const styles = getComputedStyle(container);
  const lineNumWidth = cssToPx(
    styles.getPropertyValue("--line-num-width").trim(),
    rootFontSize,
  );
  const cellPadding = cssToPx(
    styles.getPropertyValue("--cell-padding").trim(),
    rootFontSize,
  );
  const gutterWidth = lineNumWidth > 0 ? lineNumWidth + 2 * cellPadding : 0;
  const columns = Math.floor(
    (container.clientWidth - gutterWidth - 2 * cellPadding) / charWidth,
  );
  return Math.min(MAX_PRINT_WIDTH, Math.max(minColumns, columns));
}

export function observePrintWidth(
  container: HTMLElement,
  onWidth: (columns: number) => void,
  minColumns: number = DEFAULT_MIN_COLUMNS,
): () => void {
  const measure = () => onWidth(computePrintWidth(container, minColumns));
  measure();
  let lastWidth = container.clientWidth;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const observer = new ResizeObserver(() => {
    const width = container.clientWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 500);
  });
  observer.observe(container);
  return () => {
    clearTimeout(resizeTimer);
    observer.disconnect();
  };
}
