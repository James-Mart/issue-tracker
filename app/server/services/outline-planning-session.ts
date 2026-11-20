import { z } from "zod";
import {
  outlineCheckSessionMessage,
  outlineDecomposerSessionMessage,
  outlinePlannerSessionMessage,
  outlinePlanningSessionModel,
  outlinePlanningSessionTitle,
  outlineReconcileSessionMessage,
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

export type DecomposeRequest = Pick<
  StartOutlineDecomposerSession,
  "executionGate" | "mergePolicy"
>;

const decomposeRequestSchema = z
  .object({
    executionGate: z.enum(["on", "off"]),
    mergePolicy: z.string().optional(),
  })
  .strict();

/** Body of `POST /outline/decompose`. Unknown fields are refused. */
export function parseDecomposeRequest(body: unknown): DecomposeRequest {
  const parsed = decomposeRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new IssueError(
      "validation",
      formatZodError(parsed.error, "invalid decompose body"),
    );
  }
  return {
    executionGate: parsed.data.executionGate,
    mergePolicy: parsed.data.mergePolicy,
  };
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
  const outline = readOutlineOrThrow(input.outlineId);
  const outlineIdea = outline.sourceIdea
    ? readSourceIdeaOrThrow(outline.sourceIdea)
    : undefined;
  const model = outlinePlanningSessionModel(outlineIdea?.stakeholder);
  const title = outlinePlanningSessionTitle(input.role, outline.title);
  const message = sessionMessage(input, outline, outlineIdea);
  const { meta, firstPrompt } = await createIssueChannelSession(
    {
      projectId: outline.partOf,
      title,
      model,
      issueId: outline.id,
      channel: outlineChannelForRole(input.role),
      outlineRole: input.role,
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

function sessionMessage(
  input: StartOutlinePlanningSessionInput,
  outline: OutlineIssue,
  outlineIdea: IdeaIssue | undefined,
): string {
  if (input.role === "planner") {
    if (!outlineIdea) {
      throw new IssueError(
        "validation",
        `outline "${outline.id}" has no source idea to plan`,
      );
    }
    return outlinePlannerSessionMessage(outlineIdea.id);
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
