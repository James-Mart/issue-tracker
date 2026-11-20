import { z } from "zod";
import {
  outlineCheckSessionMessage,
  outlineDecomposerSessionMessage,
  outlineNewPlanningSessionMessage,
  outlinePlanningSessionModel,
  outlinePlanningSessionTitle,
  outlineReconcileSessionMessage,
  resolveExecutionGate,
  type OutlineExecutionGate,
  type OutlineReconcileScope,
} from "../../src/features/issues/lib/outline-planning-launch.js";
import {
  formatZodError,
  outlineChannelForRole,
  type ConversationMeta,
  type Issue,
} from "../schemas.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import {
  createIssueChannelSession,
  startFirstPrompt,
  type FirstPrompt,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { readIdeaOrThrow, readOutlineOrThrow } from "./issues.js";

type OutlineIssue = Extract<Issue, { kind: "outline" }>;
type IdeaIssue = Extract<Issue, { kind: "idea" }>;

export type StartOutlinePlannerSession = {
  outlineId: string;
  role: "planner";
  brief: string;
};

export type StartOutlineDecomposerSession = {
  outlineId: string;
  role: "decomposer";
  version: number;
  executionGate: OutlineExecutionGate;
  mergePolicy?: string;
};

export type StartOutlineReconcileSession = {
  outlineId: string;
  role: "reconcile";
  version: number;
} & OutlineReconcileScope;

export type StartOutlineCheckSession = {
  outlineId: string;
  role: "check";
  reviewId: string;
  submissionId: string;
  storyId: string;
  threadIds: readonly string[];
};

export type StartOutlinePlanningSessionInput =
  | StartOutlinePlannerSession
  | StartOutlineDecomposerSession
  | StartOutlineReconcileSession
  | StartOutlineCheckSession;

const decomposeRequestSchema = z.object({}).strict();

/** Refuse a start body that is not a strict empty object. */
function assertEmptyStartBody(body: unknown, fallback: string): void {
  const parsed = decomposeRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new IssueError("validation", formatZodError(parsed.error, fallback));
  }
}

/**
 * Body of `POST /outline/decompose`. The outline stores `executionGate` and
 * `mergePolicy`; a body that carries either, or any other field, is refused.
 */
export function assertEmptyDecomposeBody(body: unknown): void {
  assertEmptyStartBody(body, "invalid decompose body");
}

/** Body of `POST /outline/reconcile`. Any field is refused. */
export function assertEmptyReconcileBody(body: unknown): void {
  assertEmptyStartBody(body, "invalid reconcile body");
}

/** Decomposer start for one outline, from its stored gate and merge policy. */
export function decomposerSessionFromOutline(
  outline: OutlineIssue,
): StartOutlineDecomposerSession {
  return {
    outlineId: outline.id,
    role: "decomposer",
    version: outline.bodyVersion,
    executionGate: resolveExecutionGate(
      outline.executionGate,
      outline.codeApprovalRequired,
    ),
    mergePolicy: outline.mergePolicy,
  };
}

const planningSessionRequestSchema = z
  .object({
    brief: z.string(),
  })
  .strict();

export type PlanningSessionRequest = Pick<StartOutlinePlannerSession, "brief">;

/** A non-empty brief for a direct planner start. Blank input is refused. */
function requirePlanningBrief(raw: string): string {
  const brief = raw.trim();
  if (brief === "") {
    throw new IssueError("validation", "brief is required");
  }
  return brief;
}

/** Body of `POST /planning/sessions`. Unknown fields are refused. */
export function parsePlanningSessionRequest(body: unknown): PlanningSessionRequest {
  const parsed = planningSessionRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new IssueError(
      "validation",
      formatZodError(parsed.error, "invalid planning session body"),
    );
  }
  return { brief: parsed.data.brief };
}

/**
 * Open a planner session on an outline's planning channel, or a decomposer,
 * reconcile, or check session on its decomposition channel, and start its
 * first turn.
 */
export async function startOutlinePlanningSession(
  input: StartOutlinePlanningSessionInput,
  sessions: ConversationMessageSessions,
): Promise<ConversationMeta> {
  const { meta, firstPrompt } = await createOutlinePlanningSession(input, sessions);
  const started = await startFirstPrompt(meta.id, firstPrompt, sessions);
  if (!started.ok) throw new Error(started.message);
  return meta;
}

/**
 * Open the session and claim its first turn without starting it, so the
 * caller can record the conversation first. The caller starts `firstPrompt`
 * or releases its claim.
 */
export async function createOutlinePlanningSession(
  input: StartOutlinePlanningSessionInput,
  sessions: ConversationMessageSessions,
): Promise<{ meta: ConversationMeta; firstPrompt: FirstPrompt }> {
  const normalized = normalizePlanningSessionInput(input);
  const outline = readOutlineOrThrow(normalized.outlineId);
  const outlineIdea = outline.sourceIdea
    ? readSourceIdeaOrThrow(outline.sourceIdea)
    : undefined;
  const model = outlinePlanningSessionModel(outlineIdea?.stakeholder);
  const title = outlinePlanningSessionTitle(normalized.role, outline.title);
  const message = sessionMessage(normalized, outline);
  const { meta, firstPrompt } = await createIssueChannelSession(
    {
      projectId: outline.partOf,
      title,
      model,
      issueId: outline.id,
      channel: outlineChannelForRole(normalized.role),
      outlineRole: normalized.role,
      message,
    },
    sessions,
  );
  if (!firstPrompt) {
    throw new Error(`planning session "${meta.id}" was created without a prompt`);
  }
  return { meta, firstPrompt };
}

/** The Idea a `sourceIdea` field names. Any other kind is refused. */
export function readSourceIdeaOrThrow(id: string): IdeaIssue {
  return readIdeaOrThrow(id, "source idea");
}

function normalizePlanningSessionInput(
  input: StartOutlinePlanningSessionInput,
): StartOutlinePlanningSessionInput {
  if (input.role !== "planner") return input;
  return { ...input, brief: requirePlanningBrief(input.brief) };
}

function sessionMessage(
  input: StartOutlinePlanningSessionInput,
  outline: OutlineIssue,
): string {
  if (input.role === "planner") {
    return outlineNewPlanningSessionMessage(outline, input.brief);
  }
  if (input.role === "check") {
    return outlineCheckSessionMessage({
      outlineId: outline.id,
      reviewId: input.reviewId,
      submissionId: input.submissionId,
      storyId: input.storyId,
      threadIds: input.threadIds,
    });
  }
  requireSavedVersion(input.version, outline);
  if (input.role === "reconcile") {
    return outlineReconcileSessionMessage({
      outlineId: outline.id,
      version: input.version,
      targetStory: input.targetStory,
      coveredBy: input.coveredBy,
      sourceIdea: input.sourceIdea,
    });
  }
  return outlineDecomposerSessionMessage({
    outlineId: outline.id,
    version: input.version,
    executionGate: input.executionGate,
    mergePolicy: requireMergePolicy(input.mergePolicy),
  });
}

function requireMergePolicy(mergePolicy: string | undefined): string | undefined {
  if (mergePolicy === undefined) return undefined;
  const trimmed = mergePolicy.trim();
  if (trimmed === "") {
    throw new IssueError("validation", "merge policy is empty");
  }
  return trimmed;
}

function requireSavedVersion(version: number, outline: OutlineIssue): void {
  if (
    !Number.isInteger(version) ||
    version < 1 ||
    version > outline.bodyVersion
  ) {
    throw new IssueError(
      "validation",
      `version ${version} is not a saved version of outline "${outline.id}"`,
    );
  }
}
