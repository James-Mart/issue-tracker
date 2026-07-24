import { z } from "zod";
import type { ClearableKey, NullClearableObjectKey } from "./fields.js";
import { SLUG_RE } from "./slug.js";

export const KINDS = ["project", "epic", "idea", "story", "task"] as const;
export const TASK_STATUSES = ["todo", "in-progress", "fixing", "done"] as const;
export const QA_STATUSES = ["reviewing", "changes-requested", "passed"] as const;
export const RETRO_STATUSES = ["in-progress", "done"] as const;
export const MERGE_POLICIES = ["merge", "pull-request", "manual"] as const;
export const SPEC_REVIEW_STATUSES = ["passed", "failed"] as const;
export const SUPPORTING_DOC_KEYS = [
  "vision",
  "codingStandards",
  "designSystem",
] as const;

/** Chip color for a Project catalog label (`#RRGGBB` only). */
export const LABEL_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

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

export const chatMessageSchema = z.object({
  role: nonEmpty,
  name: z.string().optional(),
  body: nonEmpty,
  at: nonEmpty,
});

// The write-time input is the stored shape minus the server-stamped `at`.
export const chatMessageInputSchema = chatMessageSchema.omit({ at: true });

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatMessageInput = z.infer<typeof chatMessageInputSchema>;

export interface ChatResponse {
  messages: ChatMessage[];
  problems: Problem[];
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

export type SupportingDocKey = (typeof SUPPORTING_DOC_KEYS)[number];
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

// A Project is a minimal organizational container: no status, no assignee, and
// no needs-attention. Deliberately does not spread `mutableCommon`.
export const projectSchema = z.object({
  id: nonEmpty,
  kind: z.literal("project"),
  title: nonEmpty,
  workspace: z.string().optional(),
  mergePolicy: z.enum(MERGE_POLICIES).default("manual"),
  // Closed catalog of attachable labels (imperative; apply preserves).
  labels: projectLabelsSchema,
  // Imperative pointers to vision / coding standards / design system docs.
  supportingDocs: supportingDocsSchema.optional(),
  // Imperative ordered list of reference apps (name, url, description).
  inspirationApps: inspirationAppsSchema.optional(),
  ...orderField,
  ...timestamps,
});

export const epicSchema = z.object({
  id: nonEmpty,
  kind: z.literal("epic"),
  partOf: nonEmpty,
  blockedBy: z.array(z.string()).default([]),
  retro: z.enum(RETRO_STATUSES).optional(),
  // Catalog id assignments (imperative; apply preserves).
  labels: assignmentLabelsSchema,
  ...mutableCommon,
  ...orderField,
  ...timestamps,
});

// An Idea is a Project-level capture item: title/description/archive only —
// no assignee, needs-attention, or work-status fields.
export const ideaSchema = z.object({
  id: nonEmpty,
  kind: z.literal("idea"),
  partOf: nonEmpty,
  title: nonEmpty,
  archived: z.boolean().default(false),
  labels: assignmentLabelsSchema,
  ...orderField,
  ...timestamps,
});

export const storySchema = z.object({
  id: nonEmpty,
  kind: z.literal("story"),
  partOf: nonEmpty,
  branchName: z.string().optional(),
  stackedOn: z.string().optional(),
  prUrl: z.string().optional(),
  merged: z.boolean().default(false),
  specReview: z.enum(SPEC_REVIEW_STATUSES).optional(),
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
  commitSha: z.string().optional(),
  noDiff: z.boolean().optional(),
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
export type IssueKind = (typeof KINDS)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type QaStatus = (typeof QA_STATUSES)[number];
export type RetroStatus = (typeof RETRO_STATUSES)[number];
export type MergePolicy = (typeof MERGE_POLICIES)[number];
export type SpecReviewStatus = (typeof SPEC_REVIEW_STATUSES)[number];

/** Allowed `partOf` parent kinds per child kind (empty = no parent). */
export const PARENT_KINDS: Record<IssueKind, readonly IssueKind[]> = {
  project: [],
  epic: ["project"],
  idea: ["project"],
  story: ["project", "epic"],
  task: ["story"],
};

export function requiresPartOf(kind: IssueKind): boolean {
  return PARENT_KINDS[kind].length > 0;
}

export const CHILD_KIND: Record<IssueKind, IssueKind | null> = {
  project: "epic",
  epic: "story",
  idea: null,
  story: "task",
  task: null,
};

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
      "partOf" | "assignee" | "stackedOn" | "workspace" | "mergePolicy"
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

export interface Problem {
  id: string;
  message: string;
}

export type IssueEventType = "add" | "change" | "unlink" | "unlink-dir";
export type IssueEventScope = "issue" | "chat" | "attachments";

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
export type StoryStatus = (typeof STORY_STATUSES)[number];
export type EpicStatus = (typeof EPIC_STATUSES)[number];

export interface DerivedState {
  blocked: boolean;
  storyStatus?: StoryStatus;
  epicStatus?: EpicStatus;
  /** Derived git fork-point ref (see resolveMergeBase). */
  mergeBase?: string;
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

export type ChatParseResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; message: string };

export function parseChatMessage(raw: unknown): ChatParseResult {
  const result = chatMessageSchema.safeParse(raw);
  if (result.success) return { ok: true, message: result.data };
  return { ok: false, message: formatZodError(result.error, "invalid issue.json") };
}

export type ChatInputParseResult =
  | { ok: true; input: ChatMessageInput }
  | { ok: false; message: string };

export function parseChatMessageInput(raw: unknown): ChatInputParseResult {
  const result = chatMessageInputSchema.safeParse(raw);
  if (result.success) return { ok: true, input: result.data };
  return { ok: false, message: formatZodError(result.error, "invalid issue.json") };
}
