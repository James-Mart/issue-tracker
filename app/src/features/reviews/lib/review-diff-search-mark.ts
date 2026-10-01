import { bandRevealDelta } from "./review-diff-line-scroll";
import type { DiffSearchLineType, DiffSearchMatch } from "./review-diff-search";
import { searchHits } from "./review-diff-search";

export const REVIEW_SEARCH_CURRENT_ATTR = "data-review-search-current";
export const REVIEW_SEARCH_MATCH_ATTR = "data-review-search-match";

const MARK_SELECTOR = `[${REVIEW_SEARCH_CURRENT_ATTR}], [${REVIEW_SEARCH_MATCH_ATTR}]`;

const reviewSearchRadius = "2px";
const reviewSearchOutline = "2px solid hsl(var(--current))";
const reviewSearchCurrentFill = "hsl(var(--current) / 0.32)";
const reviewSearchMatchFill = "hsl(var(--current) / 0.16)";

/** Injected into the diff shadow root, which does not see the app stylesheet. */
export const REVIEW_SEARCH_MATCH_CSS = `
[${REVIEW_SEARCH_CURRENT_ATTR}] {
  border-radius: ${reviewSearchRadius};
  outline: ${reviewSearchOutline};
  background-color: ${reviewSearchCurrentFill};
}
[${REVIEW_SEARCH_MATCH_ATTR}] {
  border-radius: ${reviewSearchRadius};
  background-color: ${reviewSearchMatchFill};
}
`;

/** Same marks as `REVIEW_SEARCH_MATCH_CSS`, for light-DOM path text. */
export const reviewSearchCurrentStyle = {
  borderRadius: reviewSearchRadius,
  outline: reviewSearchOutline,
  backgroundColor: reviewSearchCurrentFill,
} as const;

export const reviewSearchMatchStyle = {
  borderRadius: reviewSearchRadius,
  backgroundColor: reviewSearchMatchFill,
} as const;

type ContentMatch = Extract<DiffSearchMatch, { kind: "content" }>;

function lineSelectors(match: ContentMatch): string[] {
  const type: DiffSearchLineType = match.lineType;
  if (type === "change-deletion") {
    return [
      `[data-unified] [data-line="${match.deletionLineNumber}"][data-line-type="change-deletion"]`,
      `[data-deletions] [data-line="${match.deletionLineNumber}"][data-line-type="change-deletion"]`,
    ];
  }
  if (type === "change-addition") {
    return [
      `[data-unified] [data-line="${match.additionLineNumber}"][data-line-type="change-addition"]`,
      `[data-additions] [data-line="${match.additionLineNumber}"][data-line-type="change-addition"]`,
    ];
  }
  return [
    `[data-unified] [data-line="${match.additionLineNumber}"][data-line-type="context"]`,
    `[data-deletions] [data-line="${match.deletionLineNumber}"][data-line-type="context"]`,
    `[data-additions] [data-line="${match.additionLineNumber}"][data-line-type="context"]`,
  ];
}

/** Unwrap the marks in the section's diff shadow roots. Path marks belong to React. */
export function clearReviewSearchMarks(section: ParentNode) {
  const parents = new Set<Node>();
  for (const host of section.querySelectorAll("diffs-container")) {
    for (const mark of host.shadowRoot?.querySelectorAll(MARK_SELECTOR) ?? []) {
      parents.add(mark.parentNode!);
      mark.replaceWith(...mark.childNodes);
    }
  }
  for (const parent of parents) parent.normalize();
}

function textNodes(container: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/**
 * Wrap every needle hit inside `container`; a hit may span tokens. The
 * `current`th hit gets the current mark and the rest the dimmer match mark.
 * Returns the current hit's first piece.
 */
export function wrapTextOccurrences(
  container: HTMLElement,
  needle: string,
  current: number | undefined,
): HTMLElement | null {
  const nodes = textNodes(container);
  const hits = searchHits(nodes.map((node) => node.data).join(""), needle, current);
  let first: HTMLElement | null = null;
  let cursor = 0;
  let from = 0;
  for (const node of nodes) {
    const nodeStart = cursor;
    const nodeEnd = cursor + node.data.length;
    cursor = nodeEnd;
    while (from < hits.length && hits[from].end <= nodeStart) from += 1;
    let to = from;
    while (to < hits.length && hits[to].start < nodeEnd) to += 1;
    // Split from the right so the offsets of pieces further left stay valid.
    for (const hit of hits.slice(from, to).reverse()) {
      const localStart = Math.max(0, hit.start - nodeStart);
      const localEnd = Math.min(nodeEnd, hit.end) - nodeStart;
      if (localEnd < node.data.length) node.splitText(localEnd);
      const target = localStart > 0 ? node.splitText(localStart) : node;
      const span = document.createElement("span");
      span.setAttribute(hit.current ? REVIEW_SEARCH_CURRENT_ATTR : REVIEW_SEARCH_MATCH_ATTR, "true");
      target.parentNode?.replaceChild(span, target);
      span.appendChild(target);
      if (hit.current) first ??= span;
    }
  }
  return first;
}

function findContentLine(section: ParentNode, match: ContentMatch): HTMLElement | null {
  for (const host of section.querySelectorAll("diffs-container")) {
    const shadow = host.shadowRoot;
    if (!shadow) continue;
    for (const selector of lineSelectors(match)) {
      const el = shadow.querySelector(selector);
      if (el instanceof HTMLElement && !el.closest("[data-gutter]")) return el;
    }
  }
  return null;
}

/**
 * Mark every hit on the diff lines painted so far, leaving lines already
 * marked alone, and return the current hit's mark once its line is painted.
 */
export function markReviewContentHits(
  section: ParentNode,
  needle: string,
  match: ContentMatch | undefined,
): HTMLElement | null {
  const currentLine = match ? findContentLine(section, match) : null;
  for (const host of section.querySelectorAll("diffs-container")) {
    for (const line of host.shadowRoot?.querySelectorAll<HTMLElement>("[data-content] [data-line]") ?? []) {
      if (line.querySelector(MARK_SELECTOR)) continue;
      wrapTextOccurrences(line, needle, line === currentLine ? match?.occurrence : undefined);
    }
  }
  return currentLine?.querySelector<HTMLElement>(`[${REVIEW_SEARCH_CURRENT_ATTR}]`) ?? null;
}

/**
 * Bring `mark` into view across its code column, which scrolls sideways under
 * a sticky line-number gutter. Only that column moves.
 */
export function revealMarkInCodeColumn(mark: HTMLElement) {
  const column = mark.closest<HTMLElement>("[data-code]");
  if (column == null || column.scrollWidth <= column.clientWidth) return;
  const box = column.getBoundingClientRect();
  const gutter = column.querySelector<HTMLElement>(":scope > [data-gutter]");
  if (gutter == null) throw new Error("revealMarkInCodeColumn: the code column has no gutter");
  const hit = mark.getBoundingClientRect();
  const delta = bandRevealDelta(
    { start: box.left + gutter.getBoundingClientRect().width, end: box.right },
    hit.left,
    hit.right,
  );
  if (delta !== 0) column.scrollLeft += delta;
}
