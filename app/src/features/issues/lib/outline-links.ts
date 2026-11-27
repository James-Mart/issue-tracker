import type { DerivedState, IssueRecord } from "@server/schemas";
import {
  stampedBoardRoots,
  type StampedBoardRoot,
} from "@server/services/linked-roots";

/** A root Epic or project-level Story stamped with one outline. */
export type LinkedRoot = Omit<StampedBoardRoot, "outlineId" | "archived">;

/**
 * Root Epics and project-level Stories whose `sourceOutline` names this
 * outline. Nested Stories, stacked Stories, and Tasks stay off the list.
 * Order matches the project board. `behind` is the derived flag; `open`
 * means the root is not yet complete (Epic not done, Story not merged).
 */
export function linkedRootsForOutline(
  issues: IssueRecord[],
  derived: Record<string, DerivedState>,
  outlineId: string,
  showArchived: boolean,
): LinkedRoot[] {
  return stampedBoardRoots(issues, derived, showArchived)
    .filter((root) => root.outlineId === outlineId)
    .map(({ outlineId: _outlineId, archived: _archived, ...root }) => root);
}

/**
 * Catalog "Linked work" cell. Zero stays `0 roots`. A mix reads
 * `1 epic · 2 root stories`.
 */
export function linkedWorkCountLabel(epics: number, stories: number): string {
  const parts: string[] = [];
  if (epics > 0) parts.push(epics === 1 ? "1 epic" : `${epics} epics`);
  if (stories > 0) {
    parts.push(stories === 1 ? "1 root story" : `${stories} root stories`);
  }
  return parts.length > 0 ? parts.join(" · ") : "0 roots";
}

export type OutlineCatalogLinks = {
  /** Archived roots included, matching Ready to decompose. */
  linkedRootIds: Set<string>;
  /** Archived roots omitted unless `showArchived` is set. */
  labels: Map<string, string>;
};

/**
 * Linked-root ids and catalog labels from one root walk. The id set keeps
 * an out-of-band outline in the implementation list when a root exists,
 * even if the archived toggle hides that root's count.
 */
export function outlineCatalogLinks(
  issues: readonly IssueRecord[],
  showArchived: boolean,
): OutlineCatalogLinks {
  const linkedRootIds = new Set<string>();
  const counts = new Map<string, { epics: number; stories: number }>();
  for (const root of stampedBoardRoots(issues, {}, true)) {
    linkedRootIds.add(root.outlineId);
    if (!showArchived && root.archived) continue;
    const bucket = counts.get(root.outlineId) ?? { epics: 0, stories: 0 };
    if (root.kind === "epic") bucket.epics += 1;
    else bucket.stories += 1;
    counts.set(root.outlineId, bucket);
  }
  const labels = new Map<string, string>();
  for (const [outlineId, count] of counts) {
    labels.set(outlineId, linkedWorkCountLabel(count.epics, count.stories));
  }
  return { linkedRootIds, labels };
}
