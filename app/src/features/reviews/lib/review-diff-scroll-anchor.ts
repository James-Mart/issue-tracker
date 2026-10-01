import { threadNodeInPanel } from "@/features/issues/lib/issue-change-focus-thread";

/** What the reader is looking at: the first diff line, thread, or composer showing at the scroller's top. */
export type DiffScrollAnchor = {
  /** Finds the anchor again; Pierre and React replace its node on re-render. */
  locate: (root: ParentNode) => Element | null;
  /** Anchor top minus scroller top, when taken. */
  offset: number;
  /** Scroller position when taken. */
  scrollTop: number;
};

const FILE_SELECTOR = '[data-testid="review-file"]';
const COMPOSER_SELECTOR = '[data-testid="diff-thread-composer"]';

function fileSection(root: ParentNode, path: string): Element | null {
  return root.querySelector(`${FILE_SELECTOR}[data-file-name="${CSS.escape(path)}"]`);
}

function diffLine(section: Element | null, lineIndex: string): Element | null {
  const shadow = section?.querySelector("diffs-container")?.shadowRoot;
  return (
    shadow?.querySelector(`[data-line][data-line-index="${CSS.escape(lineIndex)}"]`) ?? null
  );
}

type Candidate = { node: Element; locate: DiffScrollAnchor["locate"] };

function sectionCandidates(section: Element, path: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const node of section.querySelectorAll("[data-thread-root]")) {
    const id = node.getAttribute("data-thread-root")!;
    candidates.push({ node, locate: (root) => threadNodeInPanel(root, id) });
  }
  for (const node of section.querySelectorAll(COMPOSER_SELECTOR)) {
    const key = node.getAttribute("data-draft-key")!;
    candidates.push({
      node,
      locate: (root) =>
        root.querySelector(`${COMPOSER_SELECTOR}[data-draft-key="${CSS.escape(key)}"]`),
    });
  }
  const shadow = section.querySelector("diffs-container")?.shadowRoot;
  for (const node of shadow?.querySelectorAll("[data-line][data-line-index]") ?? []) {
    const index = node.getAttribute("data-line-index")!;
    candidates.push({ node, locate: (root) => diffLine(fileSection(root, path), index) });
  }
  return candidates;
}

/**
 * The topmost painted line, thread, or composer whose bottom is below the
 * scroller's top, in the first file that reaches it. A file with none of those
 * showing (collapsed, too large, still loading) anchors on its section.
 */
export function pickDiffScrollAnchor(root: HTMLElement): DiffScrollAnchor | undefined {
  const viewTop = root.getBoundingClientRect().top;
  for (const section of root.querySelectorAll<HTMLElement>(FILE_SELECTOR)) {
    const sectionBox = section.getBoundingClientRect();
    if (sectionBox.bottom <= viewTop) continue;
    const path = section.dataset.fileName!;
    let best: { top: number; locate: DiffScrollAnchor["locate"] } = {
      top: sectionBox.top,
      locate: (scope) => fileSection(scope, path),
    };
    let found = false;
    for (const candidate of sectionCandidates(section, path)) {
      const box = candidate.node.getBoundingClientRect();
      // Unslotted annotations and lines outside Pierre's window have no box.
      if (box.height === 0 || box.bottom <= viewTop) continue;
      if (found && box.top >= best.top) continue;
      best = { top: box.top, locate: candidate.locate };
      found = true;
    }
    return { locate: best.locate, offset: best.top - viewTop, scrollTop: root.scrollTop };
  }
  return undefined;
}

/**
 * How far the anchor has moved from where it was taken. Zero when it is gone
 * or not painted: a closed composer or a deleted thread leaves nothing to hold.
 */
export function diffScrollAnchorDrift(root: HTMLElement, anchor: DiffScrollAnchor): number {
  const box = anchor.locate(root)?.getBoundingClientRect();
  if (box == null || box.height === 0) return 0;
  return box.top - root.getBoundingClientRect().top - anchor.offset;
}
