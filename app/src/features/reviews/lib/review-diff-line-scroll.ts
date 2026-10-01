import type { Virtualizer } from "@pierre/diffs";

export type PaintedDiffLineSpan = {
  min: number;
  max: number;
  /** Painted line box height in pixels. */
  height: number;
};

/** A visible span along one scroll axis, in viewport pixels. */
export type ScrollBand = { start: number; end: number };

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

/** The painted row for this file line, or null while Pierre has not painted it. */
export function paintedDiffLine(
  root: ParentNode,
  side: "old" | "new",
  line: number,
): HTMLElement | null {
  for (const row of root.querySelectorAll("[data-line]")) {
    if (row instanceof HTMLElement && paintedLineForSide(row, side) === line) return row;
  }
  return null;
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

/** The element the diff Virtualizer scrolls. */
export function diffScrollRoot(virtualizer: Virtualizer): HTMLElement {
  const root = virtualizer.getRoot();
  if (!(root instanceof HTMLElement)) {
    throw new Error("diffScrollRoot: the Virtualizer has no scroll element");
  }
  return root;
}

/**
 * Scroll change that centers `[start, end]` in `band`; zero when it already
 * lies wholly inside, so a hit already in view does not move.
 */
export function bandRevealDelta(band: ScrollBand, start: number, end: number): number {
  if (start >= band.start && end <= band.end) return 0;
  return (start + end) / 2 - (band.start + band.end) / 2;
}

/**
 * The band of the diff scroller a reader sees below this file's pinned header,
 * in viewport pixels. On phone the page can leave the scroller's lower part
 * below the fold, so the band stops at the viewport's bottom.
 */
export function diffViewBelowHeader(root: HTMLElement, section: ParentNode): ScrollBand {
  const header = section.querySelector('[data-testid="review-file-header"]');
  if (!(header instanceof HTMLElement)) {
    throw new Error("diffViewBelowHeader: the file section has no header");
  }
  const box = root.getBoundingClientRect();
  return {
    start: box.top + header.getBoundingClientRect().height,
    end: Math.min(box.bottom, window.innerHeight),
  };
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

/** Progress of one seek toward a diff line; start each seek from `{ spanKey: "", stuck: 0 }`. */
export type DiffLineSeek = { spanKey: string; stuck: number };

/**
 * One frame of scrolling a virtualized file toward `line` until Pierre paints
 * it: bring the file into view, then jump the painted window toward the line.
 * Call once per frame until the line is painted.
 */
export function seekPaintedDiffLine(
  virtualizer: Virtualizer,
  panel: HTMLElement,
  shadow: ShadowRoot,
  side: "old" | "new",
  line: number,
  seek: DiffLineSeek,
) {
  const rootBox = diffScrollRoot(virtualizer).getBoundingClientRect();
  const panelBox = panel.getBoundingClientRect();
  if (panelBox.bottom <= rootBox.top || panelBox.top >= rootBox.bottom) {
    virtualizer.scrollTo({ top: virtualizer.getOffsetInScrollContainer(panel) });
    seek.spanKey = "";
    seek.stuck = 0;
    return;
  }
  const span = paintedDiffLineSpan(shadow, side);
  if (span == null) return;
  const spanKey = `${span.min}:${span.max}`;
  const next = nextDiffLineScrollTop(virtualizer.getScrollTop(), span, line);
  // Land the line inside the window, not on the overscan edge that never paints it.
  const cushion = span.height * 40;
  const direction = line > span.max ? 1 : -1;
  if (next != null && spanKey !== seek.spanKey) {
    seek.spanKey = spanKey;
    seek.stuck = 0;
    virtualizer.scrollTo({ top: next + direction * cushion });
  } else if (next != null && seek.stuck < 2) {
    // Pierre's overscan can leave the target just outside the painted
    // span after one jump, and the span key does not change. One more
    // nudge of the same cushion is the bound; further jumps are not.
    seek.stuck += 1;
    virtualizer.scrollTo({
      top: virtualizer.getScrollTop() + direction * cushion,
    });
  }
}
