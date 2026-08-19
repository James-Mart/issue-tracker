import {
  MERGE_POLICIES,
  type IssuePatch,
  type MergePolicy,
} from "./schemas.js";

/** Display token for an unset tree/detail chip (`mergeBase=(unset)`, `branch=(unset)`). */
export const CHIP_UNSET = "(unset)";

export const COMMON_MERGEABLE_KEYS = [
  "title",
  "assignee",
  "needsAttention",
  "attentionReason",
  "archived",
  "partOf",
  "order",
] as const;

// Project mergeable meta keys (labels has a dedicated catalog editor).
export const PROJECT_FORM_FIELD_KEYS = ["workspace", "trunk", "mergePolicy"] as const;

export const PROJECT_FIELD_KEYS = [
  ...PROJECT_FORM_FIELD_KEYS,
  "labels",
  "supportingDocs",
  "inspirationApps",
  "personas",
] as const;

export const EPIC_FIELD_KEYS = ["blockedBy"] as const;

export const EPIC_IMPERATIVE_ONLY_KEYS = [
  "mergeBaseOverride",
  "mergePolicy",
  "retro",
  "labels",
  "sourceIdea",
] as const;

export const EPIC_RUNTIME_OPTIONAL_KEYS = EPIC_IMPERATIVE_ONLY_KEYS;

// Story mergeable keys that are not imperative-only. Imperative-only keys
// (e.g. review) live in STORY_IMPERATIVE_ONLY_KEYS and are excluded.
export const STORY_FORM_FIELD_KEYS = [
  "branchName",
  "stackedOn",
  "prUrl",
  "merged",
] as const;

export const STORY_IMPERATIVE_ONLY_KEYS = [
  "mergeBaseOverride",
  "mergePolicy",
  "review",
  "reviewedTasks",
  "needsRebase",
  "retro",
  "labels",
  "sourceIdea",
] as const;

export const STORY_FIELD_KEYS = [
  ...STORY_FORM_FIELD_KEYS,
  ...STORY_IMPERATIVE_ONLY_KEYS,
] as const;

// Optional story runtime state preserved by apply when already set on disk.
export const STORY_RUNTIME_OPTIONAL_KEYS = [
  "branchName",
  "mergeBaseOverride",
  "mergePolicy",
  "prUrl",
  "review",
  "reviewedTasks",
  "needsRebase",
  "retro",
  "labels",
  "sourceIdea",
] as const;

// Idea has no mergeable runtime keys besides imperative label assignments.
export const IDEA_RUNTIME_OPTIONAL_KEYS = ["labels", "stakeholder"] as const;

// Task mergeable keys that are not imperative-only. Imperative-only keys
// (e.g. noDiff) live in TASK_IMPERATIVE_ONLY_KEYS and are excluded.
export const TASK_FORM_FIELD_KEYS = ["status", "commitSha"] as const;

export const TASK_IMPERATIVE_ONLY_KEYS = ["noDiff", "qa"] as const;

export const TASK_RUNTIME_OPTIONAL_KEYS = ["commitSha", "noDiff", "qa"] as const;

export const TASK_FIELD_KEYS = [
  ...TASK_FORM_FIELD_KEYS,
  ...TASK_IMPERATIVE_ONLY_KEYS,
] as const;

export type ProjectFormFieldKey = (typeof PROJECT_FORM_FIELD_KEYS)[number];
export type ProjectFieldKey = (typeof PROJECT_FIELD_KEYS)[number];
export type StoryFieldKey = (typeof STORY_FIELD_KEYS)[number];
export type StoryRuntimeOptionalKey = (typeof STORY_RUNTIME_OPTIONAL_KEYS)[number];

export type IdeaRuntimeOptionalKey = (typeof IDEA_RUNTIME_OPTIONAL_KEYS)[number];

export const CLEARABLE_KEYS = [
  "assignee",
  "stakeholder",
  "commitSha",
  "branchName",
  "stackedOn",
  "prUrl",
  "needsRebase",
  "workspace",
  "qa",
  "retro",
  "mergeBaseOverride",
  "mergePolicy",
  "sourceIdea",
] as const;

export type ClearableKey = (typeof CLEARABLE_KEYS)[number];

// Object-valued mergeable keys cleared with `null` (or `{}`) → field absent.
export const NULL_CLEARABLE_OBJECT_KEYS = [
  "supportingDocs",
] as const satisfies readonly (keyof IssuePatch)[];

export type NullClearableObjectKey = (typeof NULL_CLEARABLE_OBJECT_KEYS)[number];

// Mergeable patch keys cleared when patched with `false` (absent-until-true booleans).
export const FALSE_CLEARS_KEYS = ["noDiff"] as const satisfies readonly (keyof IssuePatch)[];

export type FalseClearsKey = (typeof FALSE_CLEARS_KEYS)[number];

// Mergeable patch keys that must not be cleared with null (unlike workspace).
export const NON_CLEARABLE_MERGEABLE_KEYS = ["mergePolicy"] as const satisfies readonly (keyof IssuePatch)[];

export type NonClearableMergeableKey = (typeof NON_CLEARABLE_MERGEABLE_KEYS)[number];

/** Operator-facing UI labels (sentence case). Never surface schema keys. */
export const FIELD_LABELS = {
  workspace: "Workspace",
  trunk: "Trunk",
  mergePolicy: "Merge policy",
  title: "Title",
  assignee: "Assignee",
  needsAttention: "Needs attention",
  attentionReason: "Attention reason",
  archived: "Archived",
  partOf: "Part of",
  order: "Order",
  branchName: "Branch",
  mergeBase: "Merge base",
  stackedOn: "Stacked on",
  blockedBy: "Blocked by",
  prUrl: "Pull request",
  merged: "Merged",
  review: "Review",
  reviewedTasks: "Reviewed tasks",
  needsRebase: "Needs rebase",
  status: "Status",
  qa: "QA",
  retro: "Retro",
  commitSha: "Commit",
  noDiff: "No diff",
  labels: "Labels",
  supportingDocs: "Supporting docs",
  inspirationApps: "Inspiration apps",
  personas: "Personas",
  stakeholder: "Stakeholder",
} as const;

/** Select value for manual planning — unset on disk. */
export const MANUAL_STAKEHOLDER_VALUE = "__manual__";

export const MANUAL_STAKEHOLDER_LABEL = "The human drives";

export const MERGE_POLICY_LABELS = {
  merge: "Merge",
  "pull-request": "Pull request",
  manual: "Manual",
  "fast-forward": "Fast-forward",
} as const satisfies Record<MergePolicy, string>;

/** Danger order: manual(0) < pull-request(1) < merge(2) < fast-forward(3). */
export const MERGE_POLICY_RANK = {
  manual: 0,
  "pull-request": 1,
  merge: 2,
  "fast-forward": 3,
} as const satisfies Record<MergePolicy, number>;

export const MERGE_POLICY_OPTIONS = MERGE_POLICIES.map((value) => ({
  value,
  label: MERGE_POLICY_LABELS[value],
}));

export const MERGEABLE_KEYS = [
  ...COMMON_MERGEABLE_KEYS,
  ...PROJECT_FIELD_KEYS,
  ...EPIC_FIELD_KEYS,
  ...EPIC_IMPERATIVE_ONLY_KEYS,
  ...IDEA_RUNTIME_OPTIONAL_KEYS,
  ...STORY_FIELD_KEYS,
  ...TASK_FIELD_KEYS,
] as const satisfies readonly (keyof IssuePatch)[];
