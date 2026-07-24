import {
  LABEL_COLOR_RE,
  type Issue,
  type IssueKind,
  type IssueRecord,
  type ProjectLabel,
} from "@server/schemas";
import { SLUG_RE } from "@server/slug";

export const LABEL_DESCRIPTION_MAX = 120;

export type LabelAssignableKind = "epic" | "idea" | "story";
export type LabelAssignableIssue = Extract<Issue, { kind: LabelAssignableKind }>;

export function isLabelAssignableKind(
  kind: IssueKind,
): kind is LabelAssignableKind {
  return kind === "epic" || kind === "idea" || kind === "story";
}

export function isLabelAssignableIssue(
  issue: Issue,
): issue is LabelAssignableIssue {
  return isLabelAssignableKind(issue.kind);
}

/** Project catalog for `projectId`, or `[]` when missing / not a project. */
export function projectCatalogLabels(
  byId: Map<string, IssueRecord>,
  projectId: string | null | undefined,
): ProjectLabel[] {
  if (!projectId) return [];
  const project = byId.get(projectId);
  return project?.kind === "project" ? (project.labels ?? []) : [];
}

export function assignmentLabelsEqual(
  a: string[] | undefined,
  b: string[],
): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b);
}

/** Resolve assignment ids against the Project catalog, preserving order. */
export function resolveAssignedLabels(
  assignmentIds: string[] | undefined,
  catalog: ProjectLabel[] | undefined,
): ProjectLabel[] {
  if (!assignmentIds?.length) return [];
  const byId = new Map((catalog ?? []).map((label) => [label.id, label]));
  const resolved: ProjectLabel[] = [];
  for (const id of assignmentIds) {
    const label = byId.get(id);
    if (label) resolved.push(label);
  }
  return resolved;
}

/** Drop assignment ids absent from the catalog, preserving order. */
export function sanitizeAssignmentIds(
  assignmentIds: string[] | undefined,
  catalog: ProjectLabel[] | undefined,
): string[] {
  return resolveAssignedLabels(assignmentIds, catalog).map((label) => label.id);
}

export function toggleAssignmentId(current: string[], id: string): string[] {
  if (current.includes(id)) return current.filter((value) => value !== id);
  return [...current, id];
}

/** OR across selected catalog ids; empty selection matches everything. */
export function issueMatchesLabelFilter(
  issue: IssueRecord,
  selectedIds: string[],
): boolean {
  if (selectedIds.length === 0) return true;
  if (!isLabelAssignableIssue(issue)) return false;
  const assigned = issue.labels ?? [];
  return selectedIds.some((id) => assigned.includes(id));
}

export type CatalogDraft = {
  key: string;
  originalId: string | null;
  id: string;
  color: string;
  description: string;
};

export function catalogDraftsFromIssue(
  labels: ProjectLabel[] | undefined,
): CatalogDraft[] {
  return (labels ?? []).map((label) => ({
    key: label.id,
    originalId: label.id,
    id: label.id,
    color: label.color,
    description: label.description ?? "",
  }));
}

export function newCatalogDraft(): CatalogDraft {
  return {
    key: `new-${crypto.randomUUID()}`,
    originalId: null,
    id: "",
    color: "#64748b",
    description: "",
  };
}

export function normalizeCatalogLabel(draft: CatalogDraft): ProjectLabel {
  const description = draft.description.trim();
  return {
    id: draft.id.trim(),
    color: draft.color.trim(),
    ...(description ? { description } : {}),
  };
}

export function catalogLabelsEqual(
  a: ProjectLabel[] | undefined,
  b: ProjectLabel[],
): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b);
}

export function validateCatalogDraft(draft: CatalogDraft): string | null {
  const id = draft.id.trim();
  if (!id) return "Label id is required";
  if (!SLUG_RE.test(id)) {
    return "Label id must be kebab-case";
  }
  const color = draft.color.trim();
  if (!LABEL_COLOR_RE.test(color)) {
    return "Color must be #RRGGBB";
  }
  if (draft.description.length > LABEL_DESCRIPTION_MAX) {
    return `Description must be at most ${LABEL_DESCRIPTION_MAX} characters`;
  }
  return null;
}

export function validateCatalogDrafts(drafts: CatalogDraft[]): string | null {
  const seen = new Set<string>();
  for (const draft of drafts) {
    const error = validateCatalogDraft(draft);
    if (error) return error;
    const id = draft.id.trim();
    if (seen.has(id)) return `Duplicate label id "${id}"`;
    seen.add(id);
  }
  return null;
}

export type CatalogLabelsSavePlan = {
  /** Same-length rename staging PATCHes (before adds/removes). */
  stagingPatches: ProjectLabel[][];
  /** Labels for the main form PATCH, or null when unchanged / already staged. */
  finalLabels: ProjectLabel[] | null;
};

export type CatalogLabelsSaveResult =
  | { ok: true; plan: CatalogLabelsSavePlan }
  | { ok: false; error: string };

/** True when next differs from persisted only by renaming oldId → newId. */
function isPureSingleIdSwap(
  persisted: ProjectLabel[],
  nextLabels: ProjectLabel[],
  oldId: string,
  newId: string,
): boolean {
  if (persisted.length !== nextLabels.length) return false;
  const prevIds = new Set(persisted.map((label) => label.id));
  const nextIds = new Set(nextLabels.map((label) => label.id));
  const removed = [...prevIds].filter((id) => !nextIds.has(id));
  const added = [...nextIds].filter((id) => !prevIds.has(id));
  return (
    removed.length === 1 &&
    added.length === 1 &&
    removed[0] === oldId &&
    added[0] === newId
  );
}

/**
 * Plan catalog writes for a Project save. A pure single-id rename (same
 * length, one removed + one added) fits in one final PATCH. Any rename mixed
 * with adds/removes — or multiple renames — stages same-length swaps first so
 * assignment rewrite fires, then applies the rest via `finalLabels`.
 */
export function planCatalogLabelsSave(
  persisted: ProjectLabel[] | undefined,
  drafts: CatalogDraft[],
): CatalogLabelsSaveResult {
  const error = validateCatalogDrafts(drafts);
  if (error) return { ok: false, error };

  const nextLabels = drafts.map(normalizeCatalogLabel);
  if (catalogLabelsEqual(persisted, nextLabels)) {
    return { ok: true, plan: { stagingPatches: [], finalLabels: null } };
  }

  const current = persisted ?? [];
  const renames = drafts.filter(
    (draft) => draft.originalId && draft.originalId !== draft.id.trim(),
  );

  if (renames.length === 0) {
    return { ok: true, plan: { stagingPatches: [], finalLabels: nextLabels } };
  }

  if (
    renames.length === 1 &&
    isPureSingleIdSwap(
      current,
      nextLabels,
      renames[0].originalId!,
      renames[0].id.trim(),
    )
  ) {
    return { ok: true, plan: { stagingPatches: [], finalLabels: nextLabels } };
  }

  let working = [...current];
  const stagingPatches: ProjectLabel[][] = [];
  for (const draft of renames) {
    const oldId = draft.originalId!;
    const next = normalizeCatalogLabel(draft);
    if (!working.some((label) => label.id === oldId)) continue;
    if (working.some((label) => label.id === next.id)) {
      return { ok: false, error: `label id "${next.id}" already exists` };
    }
    working = working.map((label) => (label.id === oldId ? next : label));
    stagingPatches.push(working.map((label) => ({ ...label })));
  }

  return {
    ok: true,
    plan: {
      stagingPatches,
      finalLabels: catalogLabelsEqual(working, nextLabels) ? null : nextLabels,
    },
  };
}

/**
 * Apply rename staging patches. Returns `finalLabels` for the caller to fold
 * into a combined PATCH or apply immediately.
 */
export async function applyCatalogLabelsPlan(
  plan: CatalogLabelsSavePlan,
  apply: (labels: ProjectLabel[]) => Promise<void>,
): Promise<ProjectLabel[] | null> {
  for (const labels of plan.stagingPatches) {
    await apply(labels);
  }
  return plan.finalLabels;
}

/** Dark text on light chips, light text on dark chips. */
export function labelChipTextColor(color: string): string {
  if (!LABEL_COLOR_RE.test(color)) return "#ffffff";
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111827" : "#ffffff";
}
