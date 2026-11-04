import { z } from "zod";
import {
  outlineDecomposerSessionMessage,
  outlinePlannerSessionMessage,
  outlinePlanningSessionModel,
  outlinePlanningSessionTitle,
  outlineReconcileSessionMessage,
  type OutlineExecutionGate,
  type OutlineReconcileScope,
} from "../../src/features/issues/lib/outline-planning-launch.js";
import { formatZodError, type ConversationMeta, type Issue } from "../schemas.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import { startIssueChannelSession } from "./conversations.js";
import { IssueError } from "./errors.js";
import { readIssueOrThrow, readOutlineOrThrow } from "./issues.js";

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

export type StartOutlinePlanningSessionInput =
  | StartOutlinePlannerSession
  | StartOutlineDecomposerSession
  | StartOutlineReconcileSession;

const decomposeRequestSchema = z
  .object({
    executionGate: z.enum(["on", "off"]),
  })
  .strict();

/** Body of `POST /outline/decompose`. Unknown fields are refused. */
export function parseDecomposeRequest(body: unknown): OutlineExecutionGate {
  const parsed = decomposeRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new IssueError(
      "validation",
      formatZodError(parsed.error, "invalid decompose body"),
    );
  }
  return parsed.data.executionGate;
}

/**
 * Open a planner, decomposer, or reconcile session on an outline's planning
 * channel and start its first turn.
 */
export async function startOutlinePlanningSession(
  input: StartOutlinePlanningSessionInput,
  sessions: ConversationMessageSessions,
): Promise<ConversationMeta> {
  const outline = readOutlineOrThrow(input.outlineId);
  const outlineIdea = outline.sourceIdea
    ? readSourceIdeaOrThrow(outline.sourceIdea)
    : undefined;
  const model = outlinePlanningSessionModel(outlineIdea?.stakeholder);
  const title = outlinePlanningSessionTitle(input.role, outline.title);
  const message = sessionMessage(input, outline, outlineIdea);
  return startIssueChannelSession(
    {
      projectId: outline.partOf,
      title,
      model,
      issueId: outline.id,
      channel: "planning",
      message,
    },
    sessions,
  );
}

/** The Idea a `sourceIdea` field names. Any other kind is refused. */
export function readSourceIdeaOrThrow(id: string): IdeaIssue {
  const idea = readIssueOrThrow(id);
  if (idea.kind !== "idea") {
    throw new IssueError("validation", `source idea "${id}" is not an idea`);
  }
  return idea;
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
