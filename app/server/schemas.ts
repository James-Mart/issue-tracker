import { z } from "zod";
import type { ClearableKey, NullClearableObjectKey } from "./fields.js";
import { SLUG_RE } from "./slug.js";

export const KINDS = ["project", "epic", "idea", "story", "task"] as const;
export const TASK_STATUSES = ["todo", "in-progress", "fixing", "done"] as const;
export const QA_STATUSES = ["reviewing", "changes-requested", "passed"] as const;
export const RETRO_STATUSES = ["in-progress", "done"] as const;
export const MERGE_POLICIES = ["merge", "pull-request", "manual", "fast-forward"] as const;
export const REVIEW_STATUSES = ["passed", "failed"] as const;
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

export const commentSchema = z.object({
  role: nonEmpty,
  name: z.string().optional(),
  body: nonEmpty,
  at: nonEmpty,
});

// The write-time input is the stored shape minus the server-stamped `at`.
export const commentInputSchema = commentSchema.omit({ at: true });

export type Comment = z.infer<typeof commentSchema>;
export type CommentInput = z.infer<typeof commentInputSchema>;

export const mergeStoryBodySchema = z.object({
  auto: z.boolean().optional(),
  matchHeadCommit: z.string().optional(),
});

export type MergeStoryBody = z.infer<typeof mergeStoryBodySchema>;

export interface CommentsResponse {
  messages: Comment[];
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
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

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
      | "partOf"
      | "assignee"
      | "stackedOn"
      | "workspace"
      | "mergePolicy"
      | "stakeholder"
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
  "awaiting-direction",
  "planned",
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];
export type EpicStatus = (typeof EPIC_STATUSES)[number];
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export interface DerivedState {
  blocked: boolean;
  storyStatus?: StoryStatus;
  epicStatus?: EpicStatus;
  ideaStatus?: IdeaStatus;
  /** True when a stored review still covers every done Task on the Story. */
  reviewCurrent?: boolean;
  /** Derived git fork-point ref (see resolveMergeBase). */
  mergeBase?: string;
  /** Effective merge policy (stored override else inherited from parent). */
  mergePolicy?: MergePolicy;
  /** Epic and root project-level Story ids whose stored sourceIdea points here. */
  planRoots?: string[];
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

// --- Conversations (durable agent transcript store; peer of issues/) ---

export const CONVERSATION_CHANNELS = ["planning", "implementing"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const conversationMetaSchema = z
  .object({
    id: nonEmpty,
    title: nonEmpty,
    projectId: nonEmpty,
    issueId: nonEmpty.optional(),
    channel: z.enum(CONVERSATION_CHANNELS).optional(),
    agentId: nonEmpty.optional(),
    model: nonEmpty,
    pendingMessage: z.object({ text: nonEmpty, at: nonEmpty }).optional(),
    archived: z.boolean().default(false),
    createdAt: nonEmpty,
    updatedAt: nonEmpty,
  })
  .superRefine((meta, ctx) => {
    const hasIssueId = meta.issueId !== undefined;
    const hasChannel = meta.channel !== undefined;
    if (hasIssueId === hasChannel) return;
    ctx.addIssue({
      code: "custom",
      message: hasIssueId
        ? "channel is required when issueId is set"
        : "issueId is required when channel is set",
      path: hasIssueId ? ["channel"] : ["issueId"],
    });
  });

export type ConversationMeta = z.infer<typeof conversationMetaSchema>;

/** List API item: persisted meta plus in-process active-run flag. */
export const conversationListItemSchema = conversationMetaSchema.extend({
  activeRun: z.boolean(),
});

export type ConversationListItem = z.infer<typeof conversationListItemSchema>;

/**
 * GET /api/issues/:id/channels/:channel/sessions item — roster fields for an
 * issue-anchored session (narrower than ConversationListItem).
 */
export const channelSessionListItemSchema = z.object({
  id: nonEmpty,
  title: nonEmpty,
  model: nonEmpty,
  createdAt: nonEmpty,
  updatedAt: nonEmpty,
  archived: z.boolean(),
  activeRun: z.boolean(),
  awaitingHuman: z.boolean(),
});

export type ChannelSessionListItem = z.infer<
  typeof channelSessionListItemSchema
>;

/** GET /api/conversations/:id/run response. */
export const conversationActiveRunSchema = z.object({
  active: z.boolean(),
  runId: z.string().nullable(),
  startedAt: z.string().nullable(),
});

export type ConversationActiveRun = z.infer<typeof conversationActiveRunSchema>;

const toolCallStatus = z.enum(["running", "completed", "error"]);

/** Shared tool-call envelope fields (nested step + top-level event). */
const toolCallFields = {
  callId: nonEmpty,
  name: z.string().optional(),
  status: toolCallStatus,
  args: z.unknown().optional(),
  result: z.unknown().optional(),
};

const usageMetricsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalTokens: z.number(),
  reasoningTokens: z.number().optional(),
});

/**
 * One step in a sub-agent nested thread. Shared by the persisted
 * `subagent_update` event, the sub-agent view-model, and the UI. v1 stores a
 * single nesting level; the union is the extension point for deeper levels
 * later without renaming this type.
 */
export const nestedStepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("thinking"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("tool_call"),
    ...toolCallFields,
  }),
  z.object({
    kind: z.literal("step"),
    stepId: z.number().int(),
    status: z.enum(["started", "completed"]),
  }),
  z.object({
    kind: z.literal("liveness"),
    elapsedMs: z.number(),
  }),
]);

export type NestedStep = z.infer<typeof nestedStepSchema>;

// Write-time variants (no `at`). Stored schemas merge each with `{ at }`.
const promptEventInput = z.object({
  type: z.literal("prompt"),
  text: z.string(),
});
const assistantEventInput = z.object({
  type: z.literal("assistant"),
  text: z.string(),
});
const thinkingEventInput = z.object({
  type: z.literal("thinking"),
  text: z.string(),
});
const toolCallEventInput = z.object({
  type: z.literal("tool_call"),
  ...toolCallFields,
  // Optional post-completion hints from a Task/Agent tool_call.result.
  resultAgentId: nonEmpty.optional(),
  transcriptPath: nonEmpty.optional(),
});
const taskEventInput = z.object({
  type: z.literal("task"),
  status: z.string().optional(),
  text: z.string().optional(),
});
const statusEventInput = z.object({
  type: z.literal("status"),
  status: z.string(),
  message: z.string().optional(),
});
const usageEventInput = z.object({
  type: z.literal("usage"),
  usage: usageMetricsSchema,
});
const requestEventInput = z.object({
  type: z.literal("request"),
  requestId: nonEmpty,
});
const subagentUpdateEventInput = z.object({
  type: z.literal("subagent_update"),
  parentCallId: nonEmpty,
  step: nestedStepSchema,
  /** Nested run this step belongs to; absent on pre-bridge transcripts. */
  delegationId: nonEmpty.optional(),
  /** Delegating run; unset when the conversation root delegated. */
  parentDelegationId: nonEmpty.optional(),
  /** Effective model: resolved base id plus parameters. */
  model: nonEmpty.optional(),
});
const errorEventInput = z.object({
  type: z.literal("error"),
  message: z.string(),
});
/** Matches `AgentFailureClass` in agent-failure.ts — keep the two lists aligned. */
export const agentFailureClassSchema = z.enum([
  "auth",
  "agent-failed",
  "cancelled",
  "stalled-before-first-token",
  "transport-exhausted",
]);
const delegationRecoveryEventInput = z.object({
  type: z.literal("delegation_recovery"),
  failureClass: agentFailureClassSchema,
  madeProgress: z.boolean(),
  cancelledDelegations: z.number().int().nonnegative(),
  message: z.string(),
});

/** Write-time input: stored shape minus the server-stamped `at`. */
export const transcriptEventInputSchema = z.discriminatedUnion("type", [
  promptEventInput,
  assistantEventInput,
  thinkingEventInput,
  toolCallEventInput,
  taskEventInput,
  statusEventInput,
  usageEventInput,
  requestEventInput,
  subagentUpdateEventInput,
  errorEventInput,
  delegationRecoveryEventInput,
]);

export type TranscriptEventInput = z.infer<typeof transcriptEventInputSchema>;

/** Resolved agent run on an issue — derived from delegations + transcript tool calls. */
export const agentRunSchema = z.object({
  delegationId: nonEmpty,
  agentId: nonEmpty,
  role: nonEmpty,
  model: nonEmpty,
  issueId: nonEmpty,
  parentCallId: nonEmpty,
  conversationId: nonEmpty,
  startedAt: nonEmpty,
  status: z.enum(["running", "completed", "error"]),
  endedAt: nonEmpty.optional(),
  isResume: z.boolean(),
});

export type AgentRun = z.infer<typeof agentRunSchema>;

/** Live-only run lifecycle signalling on the event stream (never persisted). */
const runFrameInput = z.object({
  type: z.literal("run"),
  status: z.enum(["started", "finished"]),
  runId: nonEmpty,
});

export type RunFrameInput = z.infer<typeof runFrameInput>;

/** Live-only pending-message signalling on the event stream (never persisted). */
const pendingFrameInput = z.object({
  type: z.literal("pending"),
  text: z.string().nullable(),
});

export type PendingFrameInput = z.infer<typeof pendingFrameInput>;

/** Live-only issue-scoped delegation start on the event stream (never persisted). */
const delegationFrameInput = z.object({
  type: z.literal("delegation"),
  run: agentRunSchema,
});

export type DelegationFrameInput = z.infer<typeof delegationFrameInput>;

/** Write-time frame union: transcript events plus live-only run signalling. */
export const conversationFrameInputSchema = z.union([
  transcriptEventInputSchema,
  runFrameInput,
  pendingFrameInput,
  delegationFrameInput,
]);

export type ConversationFrameInput = z.infer<
  typeof conversationFrameInputSchema
>;

const frameSeq = z.number().int().nonnegative();

const withStoredTranscriptMeta = <T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
) => schema.merge(z.object({ at: nonEmpty, seq: frameSeq.optional() }));

const withStreamFrameMeta = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.merge(z.object({ at: nonEmpty, seq: frameSeq }));

export const transcriptEventSchema = z.discriminatedUnion("type", [
  withStoredTranscriptMeta(promptEventInput),
  withStoredTranscriptMeta(assistantEventInput),
  withStoredTranscriptMeta(thinkingEventInput),
  withStoredTranscriptMeta(toolCallEventInput),
  withStoredTranscriptMeta(taskEventInput),
  withStoredTranscriptMeta(statusEventInput),
  withStoredTranscriptMeta(usageEventInput),
  withStoredTranscriptMeta(requestEventInput),
  withStoredTranscriptMeta(subagentUpdateEventInput),
  withStoredTranscriptMeta(errorEventInput),
  withStoredTranscriptMeta(delegationRecoveryEventInput),
]);

export type TranscriptEvent = z.infer<typeof transcriptEventSchema>;

/** Wire-format event on the SSE stream (transcript events or live run signalling). */
export const conversationStreamEventSchema = z.union([
  z.discriminatedUnion("type", [
    withStreamFrameMeta(promptEventInput),
    withStreamFrameMeta(assistantEventInput),
    withStreamFrameMeta(thinkingEventInput),
    withStreamFrameMeta(toolCallEventInput),
    withStreamFrameMeta(taskEventInput),
    withStreamFrameMeta(statusEventInput),
    withStreamFrameMeta(usageEventInput),
    withStreamFrameMeta(requestEventInput),
    withStreamFrameMeta(subagentUpdateEventInput),
    withStreamFrameMeta(errorEventInput),
    withStreamFrameMeta(delegationRecoveryEventInput),
  ]),
  withStreamFrameMeta(runFrameInput),
  withStreamFrameMeta(pendingFrameInput),
  withStreamFrameMeta(delegationFrameInput),
]);

export type ConversationStreamEvent = z.infer<
  typeof conversationStreamEventSchema
>;

export type CreateConversationInput = {
  title: string;
  projectId: string;
  model: string;
  agentId?: string;
  issueId?: string;
  channel?: ConversationChannel;
  /** When set, the first prompt event is persisted in the same write turn. */
  message?: string;
};

export type ConversationMetaPatch = Partial<
  Pick<ConversationMeta, "title" | "agentId" | "model" | "archived">
> & {
  pendingMessage?: NonNullable<ConversationMeta["pendingMessage"]> | null;
};

export type ConversationDetail = {
  meta: ConversationMeta;
  transcript: TranscriptEvent[];
};

/** GET /api/conversations/:id/transcript — cacheable history page. */
export const conversationTranscriptPageSchema = z.object({
  events: z.array(transcriptEventSchema),
  latestSeq: frameSeq,
});

export type ConversationTranscriptPage = z.infer<
  typeof conversationTranscriptPageSchema
>;

/** Write-time input: stored shape minus the server-stamped `at`. */
export const delegationRecordInputSchema = z.object({
  delegationId: nonEmpty,
  agentId: nonEmpty,
  role: nonEmpty,
  model: nonEmpty,
  /** Delegating run; unset when the conversation root delegated. */
  parentDelegationId: nonEmpty.optional(),
  /** Tracker issue this delegation was spawned for. */
  issueId: nonEmpty.optional(),
  /** Parent tool call that spawned this delegation. */
  parentCallId: nonEmpty.optional(),
});

export type DelegationRecordInput = z.infer<typeof delegationRecordInputSchema>;

export const delegationRecordSchema = delegationRecordInputSchema.merge(
  z.object({ at: nonEmpty }),
);

export type DelegationRecord = z.infer<typeof delegationRecordSchema>;

export type DelegationRecordParseResult =
  | { ok: true; record: DelegationRecord }
  | { ok: false; message: string };

export function parseDelegationRecord(raw: unknown): DelegationRecordParseResult {
  const result = delegationRecordSchema.safeParse(raw);
  if (result.success) return { ok: true, record: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid delegation record"),
  };
}

export type DelegationRecordInputParseResult =
  | { ok: true; input: DelegationRecordInput }
  | { ok: false; message: string };

export function parseDelegationRecordInput(
  raw: unknown,
): DelegationRecordInputParseResult {
  const result = delegationRecordInputSchema.safeParse(raw);
  if (result.success) return { ok: true, input: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid delegation record"),
  };
}

export type ConversationMetaParseResult =
  | { ok: true; meta: ConversationMeta }
  | { ok: false; message: string };

export function parseConversationMeta(raw: unknown): ConversationMetaParseResult {
  const result = conversationMetaSchema.safeParse(raw);
  if (result.success) return { ok: true, meta: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid meta.json"),
  };
}

export type ConversationListItemParseResult =
  | { ok: true; item: ConversationListItem }
  | { ok: false; message: string };

export function parseConversationListItem(
  raw: unknown,
): ConversationListItemParseResult {
  const result = conversationListItemSchema.safeParse(raw);
  if (result.success) return { ok: true, item: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid conversation list item"),
  };
}

export type ChannelSessionListItemParseResult =
  | { ok: true; item: ChannelSessionListItem }
  | { ok: false; message: string };

export function parseChannelSessionListItem(
  raw: unknown,
): ChannelSessionListItemParseResult {
  const result = channelSessionListItemSchema.safeParse(raw);
  if (result.success) return { ok: true, item: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid channel session list item"),
  };
}

export type ConversationActiveRunParseResult =
  | { ok: true; state: ConversationActiveRun }
  | { ok: false; message: string };

export function parseConversationActiveRun(
  raw: unknown,
): ConversationActiveRunParseResult {
  const result = conversationActiveRunSchema.safeParse(raw);
  if (result.success) return { ok: true, state: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid conversation run state"),
  };
}

export type ConversationTranscriptPageParseResult =
  | { ok: true; page: ConversationTranscriptPage }
  | { ok: false; message: string };

export function parseConversationTranscriptPage(
  raw: unknown,
): ConversationTranscriptPageParseResult {
  const result = conversationTranscriptPageSchema.safeParse(raw);
  if (result.success) return { ok: true, page: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid conversation transcript"),
  };
}

export type TranscriptEventParseResult =
  | { ok: true; event: TranscriptEvent }
  | { ok: false; message: string };

export function parseTranscriptEvent(raw: unknown): TranscriptEventParseResult {
  const result = transcriptEventSchema.safeParse(raw);
  if (result.success) return { ok: true, event: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid transcript event"),
  };
}

export type TranscriptEventInputParseResult =
  | { ok: true; input: TranscriptEventInput }
  | { ok: false; message: string };

export function parseTranscriptEventInput(
  raw: unknown,
): TranscriptEventInputParseResult {
  const result = transcriptEventInputSchema.safeParse(raw);
  if (result.success) return { ok: true, input: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid transcript event"),
  };
}

export type ConversationFrameInputParseResult =
  | { ok: true; input: ConversationFrameInput }
  | { ok: false; message: string };

export function parseConversationFrameInput(
  raw: unknown,
): ConversationFrameInputParseResult {
  const result = conversationFrameInputSchema.safeParse(raw);
  if (result.success) return { ok: true, input: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid conversation frame"),
  };
}

export type ConversationStreamEventParseResult =
  | { ok: true; event: ConversationStreamEvent }
  | { ok: false; message: string };

export function parseConversationFrame(
  raw: unknown,
): ConversationStreamEventParseResult {
  const result = conversationStreamEventSchema.safeParse(raw);
  if (result.success) return { ok: true, event: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid conversation frame"),
  };
}
