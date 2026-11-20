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
  readOutlineFromIssues,
  readOutlineOrThrow,
  serialize,
  type IssueWrite,
} from "./issues.js";
import { checkIntegrity } from "./integrity.js";
import { appendTargetOutlineId } from "./append-target.js";
import { pendingDraftVersionWrite } from "./outline-draft.js";
import { removeOutlineDraftIfUnchanged } from "./outline-draft-store.js";
import { withIdeaPlanSettings } from "./outline-plan-settings.js";
import {
  decomposerSessionFromOutline,
  startOutlinePlanningSession,
  type StartOutlineDecomposerSession,
  type StartOutlineReconcileSession,
} from "./outline-planning-session.js";
import { withPendingAppend } from "./pending-appends.js";
import { requireProjectWorkspace } from "./project-workspace.js";

type IdeaIssue = Extract<Issue, { kind: "idea" }>;
type OutlineIssue = Extract<Issue, { kind: "outline" }>;

export type CodeGateVerdict = "gated" | "start";

export type ConcludeIdeaResult = {
  concludedAt: string;
  /**
   * Set when conclude started a decomposer, or reconcile for an append.
   * Absent when the gates start nothing.
   */
  sessionId?: string;
  /** Set when an append conclude published the pending draft. */
  version?: number;
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
  session: StartOutlineDecomposerSession | StartOutlineReconcileSession;
};

/**
 * Archive an Idea and finish its plan. With no `appendTo`, copy its plan
 * settings onto its outline and start a decomposer when the gates say so.
 * With `appendTo`, publish the target outline's pending draft, record a
 * pending append carrying the Idea's gates, leave the outline's plan settings
 * as they are, and start reconcile when the gates say so. The write commits
 * before any session starts, so a failed start leaves the plan concluded.
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
    if (isAppendIdea(idea)) {
      return concludeAppend(idea, outlineId, codeGateVerdict, sessions);
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
    const started =
      start.session.role === "decomposer" ? "the decomposer" : "reconciliation";
    throw errorAfterCommit(
      error,
      `idea "${ideaId}" concluded onto outline "${outlineId}", but ${started} did not start`,
    );
  }
}

type PreparedConclude = {
  concludedAt: string;
  /** Set when an append published its draft. */
  version?: number;
  start?: SessionStart;
};

/** Neither out-of-band nor a decomposition gate holds the session back. */
function gatesStartSession(idea: IdeaIssue): boolean {
  return !idea.outOfBand && !idea.decompositionGate;
}

function isAppendIdea(
  idea: IdeaIssue,
): idea is IdeaIssue & { appendTo: string } {
  return Boolean(idea.appendTo);
}

/**
 * Publish the append Idea's unpublished draft as the outline's next version,
 * record the Idea's pending append, and archive the Idea. Plan settings and
 * `concludedAt` stay as the outline already has them.
 */
function concludeAppend(
  idea: IdeaIssue & { appendTo: string },
  outlineId: string,
  verdict: CodeGateVerdict,
  sessions: ConversationMessageSessions,
): PreparedConclude {
  const { issues } = readAll();
  const outline = appendTargetOutline(issues, idea, outlineId);
  refuseIfChannelBusy(outline.id, outlineChannelForRole("reconcile"), sessions);
  const { write, draft } = pendingDraftVersionWrite(outline.id);
  const now = new Date().toISOString();
  const codeApprovalRequired = verdict === "gated";
  const ideaNext = parseStoredIssue({
    ...idea,
    archived: true,
    codeApprovalRequired,
    updatedAt: now,
  });
  const outlineNext = parseStoredIssue(
    withPendingAppend(write.issue, {
      targetStory: idea.appendTo,
      sourceIdea: idea.id,
      executionGate: idea.executionGate,
      codeApprovalRequired,
    }),
  );
  commitChecked(
    [{ issue: ideaNext }, { ...write, issue: outlineNext }],
    issues,
  );
  removeOutlineDraftIfUnchanged(outline.id, draft);
  const version = outlineNext.bodyVersion;
  if (!gatesStartSession(idea)) return { concludedAt: now, version };
  return {
    concludedAt: now,
    version,
    start: {
      partOf: outlineNext.partOf,
      session: { outlineId: outlineNext.id, role: "reconcile", version },
    },
  };
}

function commitChecked(writes: IssueWrite[], loaded?: readonly Issue[]): void {
  const issues = loaded ?? readAll().issues;
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

function appendTargetOutline(
  issues: readonly Issue[],
  idea: IdeaIssue & { appendTo: string },
  outlineId: string,
): OutlineIssue {
  const found = appendTargetOutlineId(issues, idea.appendTo);
  if (found !== outlineId) {
    throw new IssueError(
      "validation",
      `outline "${outlineId}" is not the outline of idea "${idea.id}"'s append target`,
    );
  }
  return readOutlineFromIssues(issues, outlineId);
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
