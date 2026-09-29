export type PaintedDiffLineSpan = {
  min: number;
  max: number;
  /** Painted line box height in pixels. */
  height: number;
};

function positiveLine(value: string | null): number | null {
  if (value == null || value === "") return null;
  const line = Number(value);
  if (!Number.isInteger(line) || line <= 0) return null;
  return line;
}

/**
 * The file line number this painted row contributes for an anchor side.
 * Unified rows keep the new-file number on `data-line` except pure deletions.
 */
export function paintedLineForSide(
  row: Element,
  side: "old" | "new",
): number | null {
  const type = row.getAttribute("data-line-type") ?? "";
  const primary = positiveLine(row.getAttribute("data-line"));
  const alt = positiveLine(row.getAttribute("data-alt-line"));
  const column = row.closest("[data-unified], [data-additions], [data-deletions]");
  const deletionsColumn = column?.hasAttribute("data-deletions") === true;
  const additionsColumn = column?.hasAttribute("data-additions") === true;

  if (side === "new") {
    if (deletionsColumn || type.includes("deletion")) return alt;
    return primary;
  }
  if (additionsColumn || type.includes("addition")) return alt;
  if (deletionsColumn || type.includes("deletion")) return primary;
  // Unified context rows store the new-file number on data-line.
  return alt ?? primary;
}

export function diffLineIsPainted(
  root: ParentNode,
  side: "old" | "new",
  line: number,
): boolean {
  for (const row of root.querySelectorAll("[data-line]")) {
    if (paintedLineForSide(row, side) === line) return true;
  }
  return false;
}

/** Line numbers Pierre has actually painted for this anchor side, plus one row's height. */
export function paintedDiffLineSpan(
  root: ParentNode,
  side: "old" | "new",
): PaintedDiffLineSpan | null {
  let min = Infinity;
  let max = -Infinity;
  let height = 0;
  for (const row of root.querySelectorAll("[data-line]")) {
    const line = paintedLineForSide(row, side);
    if (line == null) continue;
    min = Math.min(min, line);
    max = Math.max(max, line);
    if (height === 0 && row instanceof HTMLElement) {
      const box = row.getBoundingClientRect().height;
      if (box > 0) height = box;
    }
  }
  if (min === Infinity || height === 0) return null;
  return { min, max, height };
}

/**
 * Scroll offset that moves a virtualized diff window toward `line`.
 * Null when `line` is already inside the painted span, so a missing row is a
 * collapsed gap rather than a window that still needs to move.
 */
export function nextDiffLineScrollTop(
  scrollTop: number,
  span: PaintedDiffLineSpan,
  line: number,
): number | null {
  if (line >= span.min && line <= span.max) return null;
  const edge = line < span.min ? span.min : span.max;
  return scrollTop + (line - edge) * span.height;
}
