import type { DerivedState, IssueRecord } from "@server/schemas";
import { visibleIssues } from "@server/services/archived-visibility";
import { outlineCatalogLinks } from "./outline-links";

export type OutlineRecord = Extract<IssueRecord, { kind: "outline" }>;

export const PROJECT_OUTLINES_EMPTY_TITLE = "No outlines yet";

export const PROJECT_OUTLINES_EMPTY_DETAIL =
  "This project has no outlines yet. Planning an Idea creates one.";

export const OUTLINE_CATALOG_IMPLEMENTATION_LABEL = "Implementation";

export type OutlineCatalogBands = {
  implementation: OutlineRecord[];
  outOfBand: OutlineRecord[];
};

/**
 * Outlines whose parent is this Project, newest `updatedAt` first.
 * A body save stamps `updatedAt`; version snapshots have no clock of their
 * own. Ties break by id. `showArchived` matches the rest of the tree.
 */
export function outlinesForProject(
  issues: IssueRecord[],
  projectId: string,
  showArchived: boolean,
): OutlineRecord[] {
  return visibleIssues(issues, showArchived)
    .filter(
      (issue): issue is OutlineRecord =>
        issue.kind === "outline" && issue.partOf === projectId,
    )
    .sort(byRecentVersion);
}

/**
 * Split the catalog. An outline with a linked root stays in implementation
 * whatever `outOfBand` says. Order inside each list is unchanged.
 */
export function partitionOutlineCatalog(
  outlines: readonly OutlineRecord[],
  linkedRootIds: ReadonlySet<string>,
): OutlineCatalogBands {
  const implementation: OutlineRecord[] = [];
  const outOfBand: OutlineRecord[] = [];
  for (const outline of outlines) {
    const band =
      outline.outOfBand === true && !linkedRootIds.has(outline.id)
        ? outOfBand
        : implementation;
    band.push(outline);
  }
  return { implementation, outOfBand };
}

export type OutlineCatalog = {
  outlines: OutlineRecord[];
  bands: OutlineCatalogBands;
  labels: Map<string, string>;
  readyIds: Set<string>;
};

/** Split catalog for one Project, with linked-work labels and ready rows. */
export function outlineCatalogForProject(
  issues: IssueRecord[],
  projectId: string,
  showArchived: boolean,
  derived: Record<string, DerivedState>,
): OutlineCatalog {
  const outlines = outlinesForProject(issues, projectId, showArchived);
  const links = outlineCatalogLinks(issues, showArchived);
  return {
    outlines,
    bands: partitionOutlineCatalog(outlines, links.linkedRootIds),
    labels: links.labels,
    readyIds: readyToDecomposeIds(outlines, derived),
  };
}

function readyToDecomposeIds(
  outlines: readonly { id: string }[],
  derived: Record<string, DerivedState>,
): Set<string> {
  const ids = new Set<string>();
  for (const outline of outlines) {
    if (derived[outline.id]?.readyToDecompose === true) ids.add(outline.id);
  }
  return ids;
}

/** Latest saved body, shown as `v3`. */
export function outlineVersionLabel(bodyVersion: number): string {
  return `v${bodyVersion}`;
}

/** Linked-work version cell. A stamp at the outline's latest body reads `v4 · latest`. */
export function linkedRootVersionLabel(version: number, latest: number): string {
  const label = outlineVersionLabel(version);
  return version === latest ? `${label} · latest` : label;
}

function byRecentVersion(a: OutlineRecord, b: OutlineRecord): number {
  const byTime = b.updatedAt.localeCompare(a.updatedAt);
  return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
}
