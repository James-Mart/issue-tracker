import { z } from "zod";
import { formatZodError } from "./issue.js";

const nonEmpty = z.string().min(1);

/** Live-only run list signalling on the `pipeline:runs` multiplex topic. */
export const pipelineRunsEventSchema = z.object({
  type: z.literal("pipeline-run"),
  status: z.enum(["started", "finished"]),
  conversationId: nonEmpty,
});

export type PipelineRunsEvent = z.infer<typeof pipelineRunsEventSchema>;

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
    pendingMessage: z
      .object({
        text: z.string(),
        at: nonEmpty,
        attachments: z.array(nonEmpty).optional(),
      })
      .superRefine((pending, ctx) => {
        const hasText = pending.text.length > 0;
        const hasAttachments = (pending.attachments?.length ?? 0) > 0;
        if (hasText || hasAttachments) return;
        ctx.addIssue({
          code: "custom",
          message: "pending message requires text or attachments",
          path: ["text"],
        });
      })
      .optional(),
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
  attachments: z.array(nonEmpty).optional(),
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
  /** Nested run this usage belongs to; unset on session-root usage. */
  parentCallId: nonEmpty.optional(),
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

/** Resolved agent run on an issue — derived from the delegation store. */
export const agentRunSchema = z.object({
  delegationId: nonEmpty,
  agentId: nonEmpty,
  role: nonEmpty,
  model: nonEmpty,
  issueId: nonEmpty,
  parentCallId: nonEmpty,
  conversationId: nonEmpty,
  startedAt: nonEmpty,
  status: z.enum(["running", "completed", "error", "unknown"]),
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

/** Live-only watched delegation end on the event stream (never persisted). */
const delegationEndFrameInput = z.object({
  type: z.literal("delegation_end"),
  delegationId: nonEmpty,
  parentCallId: nonEmpty,
  status: z.enum(["completed", "error"]),
  endedAt: nonEmpty,
  failureClass: agentFailureClassSchema.optional(),
});

export type DelegationEndFrameInput = z.infer<typeof delegationEndFrameInput>;

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
  withStreamFrameMeta(delegationEndFrameInput),
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

/** One conversation attachment's metadata (store is source of truth for mime). */
export const conversationAttachmentMetaSchema = z.object({
  name: nonEmpty,
  size: z.number().int().nonnegative(),
  mimeType: nonEmpty,
});

export type ConversationAttachmentMeta = z.infer<
  typeof conversationAttachmentMetaSchema
>;

/** GET /api/conversations/:id/attachments response. */
export const conversationAttachmentsListSchema = z.object({
  attachments: z.array(conversationAttachmentMetaSchema),
});

export type ConversationAttachmentsList = z.infer<
  typeof conversationAttachmentsListSchema
>;

export type ConversationAttachmentMetaParseResult =
  | { ok: true; meta: ConversationAttachmentMeta }
  | { ok: false; message: string };

export function parseConversationAttachmentMeta(
  raw: unknown,
): ConversationAttachmentMetaParseResult {
  const result = conversationAttachmentMetaSchema.safeParse(raw);
  if (result.success) return { ok: true, meta: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid conversation attachment"),
  };
}

export type ConversationAttachmentsListParseResult =
  | { ok: true; list: ConversationAttachmentsList }
  | { ok: false; message: string };

export function parseConversationAttachmentsList(
  raw: unknown,
): ConversationAttachmentsListParseResult {
  const result = conversationAttachmentsListSchema.safeParse(raw);
  if (result.success) return { ok: true, list: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid conversation attachments list"),
  };
}

export function assertConversationAttachmentMeta(
  raw: unknown,
): ConversationAttachmentMeta {
  const result = parseConversationAttachmentMeta(raw);
  if (!result.ok) throwInvalidPublishedPayload(result.message);
  return result.meta;
}

export function assertConversationAttachmentsList(
  raw: unknown,
): ConversationAttachmentsList {
  const result = parseConversationAttachmentsList(raw);
  if (!result.ok) throwInvalidPublishedPayload(result.message);
  return result.list;
}

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
  /** Present on start records written after lifecycle tracking landed. */
  lifecycle: z.literal("tracked").optional(),
});

export type DelegationRecordInput = z.infer<typeof delegationRecordInputSchema>;

export const delegationRecordSchema = delegationRecordInputSchema.merge(
  z.object({ at: nonEmpty }),
);

export type DelegationRecord = z.infer<typeof delegationRecordSchema>;

export const delegationEndRecordInputSchema = z.object({
  delegationId: nonEmpty,
  status: z.enum(["completed", "error"]),
  failureClass: agentFailureClassSchema.optional(),
});

export type DelegationEndRecordInput = z.infer<
  typeof delegationEndRecordInputSchema
>;

export const delegationEndRecordSchema = delegationEndRecordInputSchema.merge(
  z.object({
    kind: z.literal("end"),
    endedAt: nonEmpty,
  }),
);

export type DelegationEndRecord = z.infer<typeof delegationEndRecordSchema>;

export type DelegationEnd = {
  status: "completed" | "error";
  endedAt: string;
  failureClass?: z.infer<typeof agentFailureClassSchema>;
};

export type DelegationRecordWithEnd = DelegationRecord & {
  end?: DelegationEnd;
};

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

export type DelegationEndRecordParseResult =
  | { ok: true; record: DelegationEndRecord }
  | { ok: false; message: string };

export function parseDelegationEndRecord(
  raw: unknown,
): DelegationEndRecordParseResult {
  const result = delegationEndRecordSchema.safeParse(raw);
  if (result.success) return { ok: true, record: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid delegation end record"),
  };
}

export type DelegationEndRecordInputParseResult =
  | { ok: true; input: DelegationEndRecordInput }
  | { ok: false; message: string };

export function parseDelegationEndRecordInput(
  raw: unknown,
): DelegationEndRecordInputParseResult {
  const result = delegationEndRecordInputSchema.safeParse(raw);
  if (result.success) return { ok: true, input: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid delegation end record"),
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

/** Server-assembled payload failed its own schema — treat as a server bug. */
function throwInvalidPublishedPayload(message: string): never {
  throw new Error(message);
}

export function assertConversationListItem(raw: unknown): ConversationListItem {
  const result = parseConversationListItem(raw);
  if (!result.ok) throwInvalidPublishedPayload(result.message);
  return result.item;
}

export function assertChannelSessionListItem(
  raw: unknown,
): ChannelSessionListItem {
  const result = parseChannelSessionListItem(raw);
  if (!result.ok) throwInvalidPublishedPayload(result.message);
  return result.item;
}

export function assertConversationActiveRun(
  raw: unknown,
): ConversationActiveRun {
  const result = parseConversationActiveRun(raw);
  if (!result.ok) throwInvalidPublishedPayload(result.message);
  return result.state;
}

export function assertConversationTranscriptPage(
  raw: unknown,
): ConversationTranscriptPage {
  const result = parseConversationTranscriptPage(raw);
  if (!result.ok) throwInvalidPublishedPayload(result.message);
  return result.page;
}
