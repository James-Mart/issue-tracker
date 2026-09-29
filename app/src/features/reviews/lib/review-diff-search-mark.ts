import type { DiffSearchLineType, DiffSearchMatch } from "./review-diff-search";
import { nthIndex } from "./review-diff-search";

export const REVIEW_SEARCH_CURRENT_ATTR = "data-review-search-current";

const reviewSearchRadius = "2px";
const reviewSearchOutline = "2px solid hsl(var(--current))";

/** Injected into the diff shadow root, which does not see the app stylesheet. */
export const REVIEW_SEARCH_MATCH_CSS = `
[${REVIEW_SEARCH_CURRENT_ATTR}] {
  border-radius: ${reviewSearchRadius};
  outline: ${reviewSearchOutline};
}
`;

/** Same outline as `REVIEW_SEARCH_MATCH_CSS`, for a light-DOM path mark. */
export const reviewSearchCurrentStyle = {
  borderRadius: reviewSearchRadius,
  outline: reviewSearchOutline,
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

function collectMarks(root: ParentNode, out: HTMLElement[]) {
  if (!(root instanceof Element) && !(root instanceof DocumentFragment) && !(root instanceof ShadowRoot)) {
    return;
  }
  for (const mark of root.querySelectorAll<HTMLElement>(`[${REVIEW_SEARCH_CURRENT_ATTR}]`)) {
    out.push(mark);
  }
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) collectMarks(el.shadowRoot, out);
  }
}

export function clearReviewSearchMarks(root: ParentNode) {
  const marks: HTMLElement[] = [];
  collectMarks(root, marks);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    mark.replaceWith(...mark.childNodes);
    parent.normalize();
  }
}

/** Wrap the `occurrence`th needle hit inside `container`. The hit may span tokens. */
export function wrapTextOccurrence(
  container: HTMLElement,
  needle: string,
  occurrence: number,
): HTMLElement | null {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  const full = nodes.map((node) => node.textContent ?? "").join("");
  const start = nthIndex(full, needle, occurrence);
  if (start < 0) return null;
  const end = start + needle.length;

  let cursor = 0;
  let first: HTMLElement | null = null;
  for (const textNode of nodes) {
    const text = textNode.textContent ?? "";
    const nodeStart = cursor;
    const nodeEnd = cursor + text.length;
    cursor = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const localStart = Math.max(0, start - nodeStart);
    const localEnd = Math.min(text.length, end - nodeStart);
    let target = textNode;
    if (localStart > 0) target = textNode.splitText(localStart);
    const kept = localEnd - localStart;
    if ((target.textContent ?? "").length > kept) target.splitText(kept);
    const span = document.createElement("span");
    span.setAttribute(REVIEW_SEARCH_CURRENT_ATTR, "true");
    target.parentNode?.replaceChild(span, target);
    span.appendChild(target);
    first ??= span;
  }
  return first;
}

function scrollParent(start: HTMLElement): HTMLElement | null {
  let node = start.parentElement;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * The diff virtualizer only mounts a window of lines. Nudge its scroll parent
 * so `lineNumber` enters that window. Returns false when the line is already
 * in range or the scroll position cannot move.
 */
export function scrollDiffTowardLine(section: HTMLElement, lineNumber: number): boolean {
  const shadow = section.querySelector("diffs-container")?.shadowRoot;
  if (!shadow) return false;
  const rendered = [
    ...shadow.querySelectorAll<HTMLElement>("[data-content] [data-line]"),
  ];
  if (rendered.length === 0) return false;
  const numbers = rendered.map((el) => Number(el.getAttribute("data-line")));
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  if (lineNumber >= min && lineNumber <= max) return false;

  const pre = shadow.querySelector("pre");
  const renderedHeight = pre?.getBoundingClientRect().height ?? 0;
  if (renderedHeight <= 0) return false;
  const lineHeight = renderedHeight / rendered.length;
  const scroller = scrollParent(section);
  if (!scroller) return false;

  const delta = lineNumber > max ? lineNumber - max : lineNumber - min;
  const next = Math.max(0, scroller.scrollTop + delta * lineHeight);
  if (Math.abs(scroller.scrollTop - next) < 2) return false;
  scroller.scrollTop = next;
  return true;
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
 * Mark the current content hit inside the rendered diff and return it.
 * Callers scroll that node into view.
 */
export function markReviewContentMatch(
  section: ParentNode,
  match: ContentMatch,
  needle: string,
): HTMLElement | null {
  clearReviewSearchMarks(section);
  const line = findContentLine(section, match);
  if (!line) return null;
  return wrapTextOccurrence(line, needle, match.occurrence);
}
