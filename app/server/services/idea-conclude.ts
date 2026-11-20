import { z } from "zod";
import { resolveExecutionGate } from "../../src/features/issues/lib/outline-planning-launch.js";
import { outlineChannelForRole } from "../../src/features/issues/lib/outline-session-role.js";
import type { Issue } from "../schemas.js";
import { formatZodError, parseIssue } from "../schemas.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import { refuseIfChannelBusy } from "./conversations.js";
import { errorAfterCommit, IssueError } from "./errors.js";
import {
  commitIssueBatch,
  readAll,
  readIdeaOrThrow,
  readOutlineOrThrow,
  serialize,
} from "./issues.js";
import { checkIntegrity } from "./integrity.js";
import { withIdeaPlanSettings } from "./outline-plan-settings.js";
import { startOutlinePlanningSession } from "./outline-planning-session.js";
import { requireProjectWorkspace } from "./project-workspace.js";

type IdeaIssue = Extract<Issue, { kind: "idea" }>;
type OutlineIssue = Extract<Issue, { kind: "outline" }>;

export type CodeGateVerdict = "gated" | "start";

export type ConcludeIdeaResult = {
  concludedAt: string;
  /** Set when conclude started a decomposer. Absent when the gates start nothing. */
  sessionId?: string;
};

const concludeRequestSchema = z
  .object({
    outlineId: z.string().min(1),
    codeGateVerdict: z.enum(["gated", "start"]),
  })
  .strict();

/** Body of `POST /issues/:ideaId/conclude`. Unknown fields are refused. */
export function parseConcludeRequest(body: unknown): {
  outlineId: string;
  codeGateVerdict: CodeGateVerdict;
} {
  const parsed = concludeRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new IssueError(
      "validation",
      formatZodError(parsed.error, "invalid conclude body"),
    );
  }
  return parsed.data;
}

type DecomposerStart = {
  outlineId: string;
  partOf: string;
  version: number;
  executionGate: OutlineIssue["executionGate"];
  codeApprovalRequired: boolean;
  mergePolicy: OutlineIssue["mergePolicy"];
};

/**
 * Archive an Idea with no `appendTo`, copy its plan settings onto its
 * outline, and start a decomposer when the gates say so. The settings write
 * commits before the start, so a failed start leaves the outline concluded.
 */
export async function concludeIdea(
  ideaId: string,
  outlineId: string,
  codeGateVerdict: CodeGateVerdict,
  sessions: ConversationMessageSessions,
): Promise<ConcludeIdeaResult> {
  const prepared = await serialize(() => {
    const idea = readIdeaOrThrow(ideaId);
    if (idea.archived) {
      throw new IssueError("validation", `idea "${idea.id}" is already archived`);
    }
    if (idea.appendTo) {
      throw new IssueError(
        "validation",
        `idea "${idea.id}" has appendTo set; conclude copies plan settings only when appendTo is unset`,
      );
    }
    const outline = readOutlineOrThrow(outlineId);
    if (outline.sourceIdea !== idea.id) {
      throw new IssueError(
        "validation",
        `outline "${outline.id}" is not idea "${idea.id}"'s outline`,
      );
    }
    refuseIfChannelBusy(
      outline.id,
      outlineChannelForRole("decomposer"),
      sessions,
    );

    const now = new Date().toISOString();
    const written = concludeWrite(idea, outline, codeGateVerdict, now);
    const { issues } = readAll();
    const prospective = new Map(issues.map((issue) => [issue.id, issue]));
    prospective.set(written.idea.id, written.idea);
    prospective.set(written.outline.id, written.outline);
    const problems = checkIntegrity([...prospective.values()]);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((problem) => problem.message).join("; "),
      );
    }
    commitIssueBatch(
      [{ issue: written.idea }, { issue: written.outline }],
      [],
    );
    return {
      concludedAt: now,
      start: written.start,
    };
  });

  if (!prepared.start) return { concludedAt: prepared.concludedAt };

  try {
    requireProjectWorkspace(prepared.start.partOf);
    const meta = await startOutlinePlanningSession(
      {
        outlineId: prepared.start.outlineId,
        role: "decomposer",
        version: prepared.start.version,
        executionGate: resolveExecutionGate(
          prepared.start.executionGate,
          prepared.start.codeApprovalRequired,
        ),
        mergePolicy: prepared.start.mergePolicy,
      },
      sessions,
    );
    return { concludedAt: prepared.concludedAt, sessionId: meta.id };
  } catch (error) {
    throw errorAfterCommit(
      error,
      `idea "${ideaId}" concluded onto outline "${outlineId}", but the decomposer did not start`,
    );
  }
}

function concludeWrite(
  idea: IdeaIssue,
  outline: OutlineIssue,
  verdict: CodeGateVerdict,
  now: string,
): { idea: IdeaIssue; outline: OutlineIssue; start?: DecomposerStart } {
  const codeApprovalRequired = verdict === "gated";
  const ideaNext = parseStoredIssue({
    ...idea,
    archived: true,
    codeApprovalRequired,
    updatedAt: now,
  });
  const outlineNext = parseStoredIssue({
    ...withIdeaPlanSettings(outline, idea, codeApprovalRequired),
    concludedAt: now,
    updatedAt: now,
  });
  const start =
    idea.outOfBand || idea.decompositionGate
      ? undefined
      : {
          outlineId: outlineNext.id,
          partOf: outlineNext.partOf,
          version: outlineNext.bodyVersion,
          executionGate: outlineNext.executionGate,
          codeApprovalRequired,
          mergePolicy: outlineNext.mergePolicy,
        };
  return { idea: ideaNext, outline: outlineNext, start };
}

function parseStoredIssue<T extends Issue>(issue: T): T {
  const parsed = parseIssue(issue);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  return parsed.issue as T;
}
