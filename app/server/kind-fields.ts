import {
  TASK_STATUSES,
  QA_STATUSES,
  RETRO_STATUSES,
  MERGE_POLICIES,
  SPEC_REVIEW_STATUSES,
  type IssueKind,
} from "./schemas.js";
import { CLEARABLE_KEYS } from "./fields.js";

export type FieldCoerce =
  | { type: "string" }
  | { type: "boolean" }
  | { type: "enum"; values: readonly string[] }
  | { type: "json" }
  | { type: "array" }
  | { type: "labelCatalog" }
  | { type: "supportingDocs" }
  | { type: "inspirationApps" }
  | { type: "description" }
  | { type: "needsAttention" }
  | { type: "commitSha" };

export type SetFieldSpec = FieldCoerce;

export const PROJECT_SET_FIELDS = {
  title: { type: "string" },
  workspace: { type: "string" },
  mergePolicy: { type: "enum", values: MERGE_POLICIES },
  labels: { type: "labelCatalog" },
  supportingDocs: { type: "supportingDocs" },
  inspirationApps: { type: "inspirationApps" },
  description: { type: "description" },
} as const satisfies Record<string, SetFieldSpec>;

export const EPIC_SET_FIELDS = {
  title: { type: "string" },
  needsAttention: { type: "needsAttention" },
  archived: { type: "boolean" },
  partOf: { type: "string" },
  blockedBy: { type: "array" },
  labels: { type: "array" },
  retro: { type: "enum", values: RETRO_STATUSES },
  description: { type: "description" },
} as const satisfies Record<string, SetFieldSpec>;

export const IDEA_SET_FIELDS = {
  title: { type: "string" },
  archived: { type: "boolean" },
  partOf: { type: "string" },
  labels: { type: "array" },
  description: { type: "description" },
} as const satisfies Record<string, SetFieldSpec>;

export const STORY_SET_FIELDS = {
  title: { type: "string" },
  needsAttention: { type: "needsAttention" },
  archived: { type: "boolean" },
  partOf: { type: "string" },
  branchName: { type: "string" },
  stackedOn: { type: "string" },
  prUrl: { type: "string" },
  merged: { type: "boolean" },
  specReview: { type: "enum", values: SPEC_REVIEW_STATUSES },
  retro: { type: "enum", values: RETRO_STATUSES },
  labels: { type: "array" },
  description: { type: "description" },
} as const satisfies Record<string, SetFieldSpec>;

export const TASK_SET_FIELDS = {
  title: { type: "string" },
  assignee: { type: "string" },
  needsAttention: { type: "needsAttention" },
  archived: { type: "boolean" },
  partOf: { type: "string" },
  status: { type: "enum", values: TASK_STATUSES },
  qa: { type: "enum", values: QA_STATUSES },
  commitSha: { type: "commitSha" },
  noDiff: { type: "boolean" },
  description: { type: "description" },
} as const satisfies Record<string, SetFieldSpec>;

export const KIND_SET_FIELDS = {
  project: PROJECT_SET_FIELDS,
  epic: EPIC_SET_FIELDS,
  idea: IDEA_SET_FIELDS,
  story: STORY_SET_FIELDS,
  task: TASK_SET_FIELDS,
} as const satisfies Record<IssueKind, Record<string, SetFieldSpec>>;

export type GetFieldSource = "stored" | "description" | "derived";

export type GetFieldSpec = {
  source: GetFieldSource;
};

const STORED = { source: "stored" } as const satisfies GetFieldSpec;
const DESCRIPTION = { source: "description" } as const satisfies GetFieldSpec;
const DERIVED = { source: "derived" } as const satisfies GetFieldSpec;

export const PROJECT_GET_FIELDS = {
  id: STORED,
  kind: STORED,
  title: STORED,
  workspace: STORED,
  mergePolicy: STORED,
  labels: STORED,
  supportingDocs: STORED,
  inspirationApps: STORED,
  order: STORED,
  createdAt: STORED,
  updatedAt: STORED,
  description: DESCRIPTION,
} as const satisfies Record<string, GetFieldSpec>;

export const EPIC_GET_FIELDS = {
  id: STORED,
  kind: STORED,
  title: STORED,
  partOf: STORED,
  needsAttention: STORED,
  attentionReason: STORED,
  archived: STORED,
  blockedBy: STORED,
  labels: STORED,
  retro: STORED,
  order: STORED,
  createdAt: STORED,
  updatedAt: STORED,
  description: DESCRIPTION,
  epicStatus: DERIVED,
  blocked: DERIVED,
} as const satisfies Record<string, GetFieldSpec>;

export const IDEA_GET_FIELDS = {
  id: STORED,
  kind: STORED,
  title: STORED,
  partOf: STORED,
  archived: STORED,
  labels: STORED,
  order: STORED,
  createdAt: STORED,
  updatedAt: STORED,
  description: DESCRIPTION,
} as const satisfies Record<string, GetFieldSpec>;

export const STORY_GET_FIELDS = {
  id: STORED,
  kind: STORED,
  title: STORED,
  partOf: STORED,
  needsAttention: STORED,
  attentionReason: STORED,
  archived: STORED,
  branchName: STORED,
  mergeBase: DERIVED,
  stackedOn: STORED,
  prUrl: STORED,
  merged: STORED,
  specReview: STORED,
  retro: STORED,
  labels: STORED,
  order: STORED,
  createdAt: STORED,
  updatedAt: STORED,
  description: DESCRIPTION,
  storyStatus: DERIVED,
  blocked: DERIVED,
} as const satisfies Record<string, GetFieldSpec>;

export const TASK_GET_FIELDS = {
  id: STORED,
  kind: STORED,
  title: STORED,
  partOf: STORED,
  assignee: STORED,
  needsAttention: STORED,
  attentionReason: STORED,
  archived: STORED,
  status: STORED,
  qa: STORED,
  commitSha: STORED,
  noDiff: STORED,
  order: STORED,
  createdAt: STORED,
  updatedAt: STORED,
  description: DESCRIPTION,
  blocked: DERIVED,
} as const satisfies Record<string, GetFieldSpec>;

export const KIND_GET_FIELDS = {
  project: PROJECT_GET_FIELDS,
  epic: EPIC_GET_FIELDS,
  idea: IDEA_GET_FIELDS,
  story: STORY_GET_FIELDS,
  task: TASK_GET_FIELDS,
} as const satisfies Record<IssueKind, Record<string, GetFieldSpec>>;

const clearableSet = new Set<string>(CLEARABLE_KEYS);

export function isClearableSetField(field: string): boolean {
  return clearableSet.has(field);
}
