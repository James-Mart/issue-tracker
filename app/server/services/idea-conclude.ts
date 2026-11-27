import { z } from "zod";
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
  type IssueWrite,
} from "./issues.js";
import { checkIntegrity } from "./integrity.js";
import { withIdeaPlanSettings } from "./outline-plan-settings.js";
import {
  decomposerSessionFromOutline,
  startOutlinePlanningSession,
  type StartOutlineDecomposerSession,
} from "./outline-planning-session.js";
import { requireProjectWorkspace } from "./project-workspace.js";

type IdeaIssue = Extract<Issue, { kind: "idea" }>;
type OutlineIssue = Extract<Issue, { kind: "outline" }>;

export type CodeGateVerdict = "gated" | "start";

export type ConcludeIdeaResult = {
  concludedAt: string;
  /**
   * Set when conclude started a decomposer.
   * Absent when the gates start nothing.
   */
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

type SessionStart = {
  partOf: string;
  session: StartOutlineDecomposerSession;
};

/**
 * Archive an Idea and finish its plan. Copy its plan settings onto its
 * outline and start a decomposer when the gates say so. The write commits
 * before the session starts, so a failed start leaves the plan concluded.
 */
export async function concludeIdea(
  ideaId: string,
  outlineId: string,
  codeGateVerdict: CodeGateVerdict,
  sessions: ConversationMessageSessions,
): Promise<ConcludeIdeaResult> {
  const prepared = await serialize((): PreparedConclude => {
    const idea = readIdeaOrThrow(ideaId);
    if (idea.archived) {
      throw new IssueError("validation", `idea "${idea.id}" is already archived`);
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
    commitChecked([
      { issue: written.idea },
      { issue: written.outline },
    ]);
    return { concludedAt: now, start: written.start };
  });

  const { start, ...concluded } = prepared;
  if (!start) return concluded;

  try {
    requireProjectWorkspace(start.partOf);
    const meta = await startOutlinePlanningSession(start.session, sessions);
    return { ...concluded, sessionId: meta.id };
  } catch (error) {
    throw errorAfterCommit(
      error,
      `idea "${ideaId}" concluded onto outline "${outlineId}", but the decomposer did not start`,
    );
  }
}

type PreparedConclude = {
  concludedAt: string;
  start?: SessionStart;
};

/** Neither out-of-band nor a decomposition gate holds the session back. */
function gatesStartSession(idea: IdeaIssue): boolean {
  return !idea.outOfBand && !idea.decompositionGate;
}

function commitChecked(writes: IssueWrite[]): void {
  const issues = readAll().issues;
  const prospective = new Map(issues.map((issue) => [issue.id, issue]));
  for (const write of writes) prospective.set(write.issue.id, write.issue);
  const problems = checkIntegrity([...prospective.values()]);
  if (problems.length > 0) {
    throw new IssueError(
      "validation",
      problems.map((problem) => problem.message).join("; "),
    );
  }
  commitIssueBatch(writes, []);
}

function concludeWrite(
  idea: IdeaIssue,
  outline: OutlineIssue,
  verdict: CodeGateVerdict,
  now: string,
): { idea: IdeaIssue; outline: OutlineIssue; start?: SessionStart } {
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
  const start: SessionStart | undefined = gatesStartSession(idea)
    ? {
        partOf: outlineNext.partOf,
        session: decomposerSessionFromOutline(outlineNext),
      }
    : undefined;
  return { idea: ideaNext, outline: outlineNext, start };
}

function parseStoredIssue<T extends Issue>(issue: T): T {
  const parsed = parseIssue(issue);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  return parsed.issue as T;
}
