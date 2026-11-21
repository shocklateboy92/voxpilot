function cssToPx(value: string, rootFontSize: number): number {
  const num = parseFloat(value);
  return value.endsWith("rem") ? num * rootFontSize : num;
}

/** Use the same font and spacing as the rendered code. */
function computePrintWidth(container: HTMLElement, minColumns = 40): number {
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;" +
    "font-family:var(--font-mono);font-size:var(--code-font-size);";
  container.appendChild(probe);
  const font = getComputedStyle(probe);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context)
    context.font = `${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
  probe.remove();
  const charWidth = context?.measureText("0").width || 7.2;

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
  return Math.min(500, Math.max(minColumns, columns));
}

export function observePrintWidth(
  container: HTMLElement,
  onWidth: (columns: number) => void,
  minColumns?: number,
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
