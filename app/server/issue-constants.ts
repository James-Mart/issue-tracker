export const KINDS = ["project", "epic", "idea", "story", "task"] as const;
export type IssueKind = (typeof KINDS)[number];

export const MERGE_POLICIES = [
  "merge",
  "pull-request",
  "manual",
  "fast-forward",
] as const;
export type MergePolicy = (typeof MERGE_POLICIES)[number];

export const SUPPORTING_DOC_KEYS = [
  "vision",
  "codingStandards",
  "designSystem",
] as const;
export type SupportingDocKey = (typeof SUPPORTING_DOC_KEYS)[number];

/** Chip color for a Project catalog label (`#RRGGBB` only). */
export const LABEL_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/** Allowed `partOf` parent kinds per child kind (empty = no parent). */
export const PARENT_KINDS: Record<IssueKind, readonly IssueKind[]> = {
  project: [],
  epic: ["project"],
  idea: ["project"],
  story: ["project", "epic"],
  task: ["story"],
};

export const CHILD_KIND: Record<IssueKind, IssueKind | null> = {
  project: "epic",
  epic: "story",
  idea: null,
  story: "task",
  task: null,
};
