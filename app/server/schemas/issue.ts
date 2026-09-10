import { z } from "zod";
import type { ClearableKey, NullClearableObjectKey } from "../fields.js";
import {
  LABEL_COLOR_RE,
  MERGE_POLICIES,
  PARENT_KINDS,
  type IssueKind,
  type MergePolicy,
} from "../issue-constants.js";
import { SLUG_RE } from "../slug.js";

export const TASK_STATUSES = ["todo", "in-progress", "fixing", "done"] as const;
export const QA_STATUSES = ["reviewing", "changes-requested", "passed"] as const;
export const RETRO_STATUSES = ["in-progress", "done"] as const;
export const REVIEW_STATUSES = ["passed", "failed"] as const;

const nonEmpty = z.string().min(1);

const kebabId = z
  .string()
  .regex(
    SLUG_RE,
    "id must be kebab-case (lowercase letters and digits, single hyphens, no leading/trailing hyphen)",
  );

export const projectLabelSchema = z.object({
  id: kebabId,
  color: z
    .string()
    .regex(LABEL_COLOR_RE, "color must be #RRGGBB"),
  description: z.string().max(120).optional(),
});

export type ProjectLabel = z.infer<typeof projectLabelSchema>;

function dedupePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const projectLabelsSchema = z
  .array(projectLabelSchema)
  .superRefine((labels, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < labels.length; i += 1) {
      const id = labels[i].id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate label id "${id}"`,
          path: [i, "id"],
        });
      }
      seen.add(id);
    }
  })
  .optional();

// Assignment ids: unique, order-preserving. Transform normalizes duplicates on read.
const assignmentLabelsSchema = z
  .array(nonEmpty)
  .transform(dedupePreserveOrder)
  .optional();

export const commentAnchorSchema = z.object({
  path: nonEmpty,
  side: z.enum(["old", "new"]),
  line: z.number().int().positive(),
  startLine: z.number().int().positive().optional(),
  commitSha: nonEmpty,
});

export const commentSchema = z.object({
  id: nonEmpty,
  role: nonEmpty,
  name: z.string().optional(),
  body: nonEmpty,
  at: nonEmpty,
  replyTo: nonEmpty.optional(),
  anchor: commentAnchorSchema.optional(),
});

// The write-time input is the stored shape minus server-stamped `id` and `at`.
export const commentInputSchema = commentSchema.omit({ at: true, id: true });

export type Comment = z.infer<typeof commentSchema>;
export type CommentInput = z.infer<typeof commentInputSchema>;

/** Stored comment plus read-time `outdated` on anchored messages only. */
export type CommentMessage = Comment & { outdated?: boolean };

export const mergeStoryBodySchema = z.object({
  auto: z.boolean().optional(),
  matchHeadCommit: z.string().optional(),
});

export type MergeStoryBody = z.infer<typeof mergeStoryBodySchema>;

export interface CommentsResponse {
  messages: CommentMessage[];
  problems: Problem[];
}

export interface Problem {
  id: string;
  message: string;
}

const attentionFields = {
  needsAttention: z.boolean().default(false),
  attentionReason: z.string().nullable().default(null),
};

const archivableFields = {
  // Explicit visibility flag (not auto-derived from Done). Absent parses as false.
  archived: z.boolean().default(false),
};

const mutableCommon = {
  title: nonEmpty,
  ...attentionFields,
  ...archivableFields,
};

const taskMutable = {
  ...mutableCommon,
  assignee: z.string().optional(),
};
const timestamps = {
  createdAt: nonEmpty,
  updatedAt: nonEmpty,
};
const orderField = { order: z.number().int().nonnegative().default(0) };

export const supportingDocRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attachment"), name: nonEmpty }),
  z.object({ type: z.literal("workspace"), path: nonEmpty }),
]);

export const supportingDocsSchema = z
  .object({
    vision: supportingDocRefSchema.optional(),
    codingStandards: supportingDocRefSchema.optional(),
    designSystem: supportingDocRefSchema.optional(),
  })
  .strict();

export type SupportingDocRef = z.infer<typeof supportingDocRefSchema>;
export type SupportingDocs = z.infer<typeof supportingDocsSchema>;

export const inspirationAppEntrySchema = z
  .object({
    name: nonEmpty,
    url: nonEmpty,
    description: z.string(),
  })
  .strict();

export const inspirationAppsSchema = z
  .array(inspirationAppEntrySchema)
  .superRefine((apps, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < apps.length; i += 1) {
      const name = apps[i].name;
      if (seen.has(name)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate inspiration app name "${name}"`,
          path: [i, "name"],
        });
      }
      seen.add(name);
    }
  });

export type InspirationAppEntry = z.infer<typeof inspirationAppEntrySchema>;
export type InspirationApps = z.infer<typeof inspirationAppsSchema>;

export const personaEntrySchema = z
  .object({
    name: nonEmpty,
    description: z.string(),
  })
  .strict();

export const personasSchema = z
  .array(personaEntrySchema)
  .superRefine((personas, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < personas.length; i += 1) {
      const name = personas[i].name;
      if (seen.has(name)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate persona name "${name}"`,
          path: [i, "name"],
        });
      }
      seen.add(name);
    }
  });

export type PersonaEntry = z.infer<typeof personaEntrySchema>;
export type Personas = z.infer<typeof personasSchema>;

// A Project is a minimal organizational container: no status, no assignee, and
// no needs-attention. Deliberately does not spread `mutableCommon`.
export const projectSchema = z.object({
  id: nonEmpty,
  kind: z.literal("project"),
  title: nonEmpty,
  workspace: z.string().optional(),
  setupCommand: z.string().optional(),
  trunk: nonEmpty.default("main"),
  mergePolicy: z.enum(MERGE_POLICIES).default("manual"),
  // Closed catalog of attachable labels (imperative; apply preserves).
  labels: projectLabelsSchema,
  // Imperative pointers to vision / coding standards / design system docs.
  supportingDocs: supportingDocsSchema.optional(),
  // Imperative ordered list of reference apps (name, url, description).
  inspirationApps: inspirationAppsSchema.optional(),
  // Imperative ordered persona catalog (name, description).
  personas: personasSchema.optional(),
  ...orderField,
  ...timestamps,
});

export const epicSchema = z.object({
  id: nonEmpty,
  kind: z.literal("epic"),
  partOf: nonEmpty,
  blockedBy: z.array(z.string()).default([]),
  // Imperative override for first-layer Stories' derived mergeBase.
  mergeBaseOverride: z.string().optional(),
  sourceIdea: z.string().optional(),
  mergePolicy: z.enum(MERGE_POLICIES).optional(),
  retro: z.enum(RETRO_STATUSES).optional(),
  // Catalog id assignments (imperative; apply preserves).
  labels: assignmentLabelsSchema,
  ...mutableCommon,
  ...orderField,
  ...timestamps,
});

const stakeholderField = z.string().optional();

// An Idea is a Project-level capture item: title/description/archive only —
// no assignee, needs-attention, or work-status fields.
export const ideaSchema = z.object({
  id: nonEmpty,
  kind: z.literal("idea"),
  partOf: nonEmpty,
  title: nonEmpty,
  archived: z.boolean().default(false),
  approvePlan: z.boolean().optional(),
  approvalPending: z.boolean().optional(),
  appendTo: z.string().optional(),
  stakeholder: stakeholderField,
  labels: assignmentLabelsSchema,
  ...orderField,
  ...timestamps,
});

export const storySchema = z.object({
  id: nonEmpty,
  kind: z.literal("story"),
  partOf: nonEmpty,
  branchName: z.string().optional(),
  worktreePath: z.string().optional(),
  worktreeBlockedReason: z.enum(["parent-branch"]).optional(),
  worktreeSetupFailed: z.boolean().optional(),
  stackedOn: z.string().optional(),
  // Imperative override for root (project-level) Stories' derived mergeBase.
  mergeBaseOverride: z.string().optional(),
  sourceIdea: z.string().optional(),
  mergePolicy: z.enum(MERGE_POLICIES).optional(),
  prUrl: z.string().optional(),
  merged: z.boolean().default(false),
  review: z.enum(REVIEW_STATUSES).optional(),
  reviewedTasks: z.array(z.string()).default([]),
  needsRebase: z.string().optional(),
  retro: z.enum(RETRO_STATUSES).optional(),
  labels: assignmentLabelsSchema,
  ...mutableCommon,
  ...orderField,
  ...timestamps,
});

export const taskSchema = z.object({
  id: nonEmpty,
  kind: z.literal("task"),
  partOf: nonEmpty,
  status: z.enum(TASK_STATUSES).default("todo"),
  qa: z.enum(QA_STATUSES).optional(),
  commits: z.array(z.string()).default([]),
  noDiff: z.boolean().optional(),
  sourceIdea: z.string().optional(),
  appended: z.boolean().optional(),
  ...taskMutable,
  ...orderField,
  ...timestamps,
});

export const issueSchema = z.discriminatedUnion("kind", [
  projectSchema,
  epicSchema,
  ideaSchema,
  storySchema,
  taskSchema,
]);

export type Issue = z.infer<typeof issueSchema>;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type QaStatus = (typeof QA_STATUSES)[number];
export type RetroStatus = (typeof RETRO_STATUSES)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export function requiresPartOf(kind: IssueKind): boolean {
  return PARENT_KINDS[kind].length > 0;
}

type IssueFields = Omit<z.infer<typeof projectSchema>, "kind" | "labels"> &
  Omit<z.infer<typeof epicSchema>, "kind" | "labels"> &
  Omit<z.infer<typeof ideaSchema>, "kind" | "labels"> &
  Omit<z.infer<typeof storySchema>, "kind" | "labels"> &
  Omit<z.infer<typeof taskSchema>, "kind">;

// Project catalog vs Epic/Idea/Story assignment arrays share the key name but
// not the value shape — keep them out of the IssueFields intersection.
// Null-clearable object keys (see NULL_CLEARABLE_OBJECT_KEYS) accept `T | null`.
export type IssuePatch = Partial<
  Omit<
    IssueFields,
    "id" | "createdAt" | "updatedAt" | ClearableKey | NullClearableObjectKey
  >
> & {
  description?: string;
  labels?: ProjectLabel[] | string[];
} & Partial<Record<ClearableKey, string | null>> &
  Partial<{
    [K in NullClearableObjectKey]: NonNullable<IssueFields[K]> | null;
  }>;

export type CreateInput = Pick<IssueFields, "title"> &
  Partial<
    Pick<
      IssueFields,
      | "partOf"
      | "assignee"
      | "stackedOn"
      | "workspace"
      | "mergePolicy"
      | "stakeholder"
      | "approvePlan"
      | "approvalPending"
    >
  > & {
    kind: IssueKind;
    description?: string;
  };

export type IssueRecord = Issue;

export type IssueDetail = IssueRecord & {
  description: string;
  version: string;
};

export const changeCommitSchema = z.object({
  sha: nonEmpty,
  subject: z.string(),
});

export const changeStatsSchema = z.object({
  filesChanged: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const issueChangeSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("loaded"),
    commits: z.array(changeCommitSchema),
    patch: z.string(),
    stats: changeStatsSchema,
  }),
  z.object({
    state: z.literal("empty"),
    reason: z.enum(["no-commit", "no-diff", "no-descendant-commits"]),
  }),
]);

export type ChangeCommit = z.infer<typeof changeCommitSchema>;
export type ChangeStats = z.infer<typeof changeStatsSchema>;
export type IssueChange = z.infer<typeof issueChangeSchema>;

export type IssueEventType = "add" | "change" | "unlink" | "unlink-dir";
export type IssueEventScope =
  | "issue"
  | "comments"
  | "attachments"
  | "planning-run";

export interface IssueEvent {
  type: IssueEventType;
  id: string;
  scope: IssueEventScope;
}

export const STORY_STATUSES = [
  "not-started",
  "in-progress",
  "pr-open",
  "merged",
] as const;
export const EPIC_STATUSES = ["todo", "in-progress", "done"] as const;
export const IDEA_STATUSES = [
  "captured",
  "planning",
  "planned",
  "awaiting-approval",
  "awaiting-direction",
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];
export type EpicStatus = (typeof EPIC_STATUSES)[number];
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export interface DerivedWorktree {
  path?: string;
  exists: boolean;
  uncommittedCount: number;
  atRiskCommitCount: number;
  retained: boolean;
  setupFailed?: boolean;
  setupLogPath?: string;
  setupOutput?: string;
  blockedReason?: "parent-branch";
}

export interface DerivedState {
  blocked: boolean;
  storyStatus?: StoryStatus;
  epicStatus?: EpicStatus;
  ideaStatus?: IdeaStatus;
  /** True when any issue-anchored conversation on this issue is live. */
  liveRun?: boolean;
  /** True when a stored review still covers every done Task on the Story. */
  reviewCurrent?: boolean;
  /** Derived git fork-point ref (see resolveMergeBase). */
  mergeBase?: string;
  /** Effective merge policy (stored override else inherited from parent). */
  mergePolicy?: MergePolicy;
  /** Epic, root project-level Story, and Story-with-task provenance ids for this Idea. */
  planRoots?: string[];
  /** True when sourceIdea names an Idea present in the set and not archived. */
  planNotFinal?: boolean;
  /** Per-Story worktree checkout; attached by list() (git + filesystem). */
  worktree?: DerivedWorktree;
}

export interface IssuesResponse {
  issues: IssueRecord[];
  problems: Problem[];
  derived: Record<string, DerivedState>;
}

export type ParseResult =
  | { ok: true; issue: Issue }
  | { ok: false; message: string };

// Render the first zod issue as `path: message` (or just the message at the
// root). Shared by every parser here and by the `apply` doc schema so error
// shapes stay uniform; `fallback` names the doc when there is no issue.
export function formatZodError(
  error: z.ZodError,
  fallback = "invalid input",
): string {
  const first = error.issues[0];
  if (!first) return fallback;
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

export function parseIssue(raw: unknown): ParseResult {
  const result = issueSchema.safeParse(raw);
  if (result.success) return { ok: true, issue: result.data };
  return { ok: false, message: formatZodError(result.error, "invalid issue.json") };
}

export type CommentParseResult =
  | { ok: true; message: Comment }
  | { ok: false; message: string };

export function parseComment(raw: unknown): CommentParseResult {
  const result = commentSchema.safeParse(raw);
  if (result.success) return { ok: true, message: result.data };
  return { ok: false, message: formatZodError(result.error, "invalid issue.json") };
}

export type CommentInputParseResult =
  | { ok: true; input: CommentInput }
  | { ok: false; message: string };

export function parseCommentInput(raw: unknown): CommentInputParseResult {
  const result = commentInputSchema.safeParse(raw);
  if (result.success) return { ok: true, input: result.data };
  return { ok: false, message: formatZodError(result.error, "invalid issue.json") };
}
