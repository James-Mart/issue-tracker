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
import { startOutlinePlanningSession } from "./outline-planning-session.js";
import { requireProjectWorkspace } from "./project-workspace.js";

type IdeaIssue = Extract<Issue, { kind: "idea" }>;
type OutlineIssue = Extract<Issue, { kind: "outline" }>;

export type CodeGateVerdict = "gated" | "start";

export type ConcludeIdeaResult = {
  concludedAt: string;
  /** Set when conclude started a decomposer. Absent when the gates start nothing. */
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

type DecomposerStart = {
  outlineId: string;
  partOf: string;
  version: number;
  executionGate: OutlineIssue["executionGate"];
  codeApprovalRequired: boolean;
  mergePolicy: OutlineIssue["mergePolicy"];
};

/**
 * Archive an Idea and finish its plan. With no `appendTo`, copy its plan
 * settings onto its outline and start a decomposer when the gates say so.
 * With `appendTo`, publish the target outline's pending draft and leave the
 * outline's plan settings as they are. Only the no-`appendTo` path writes
 * settings before a decomposer start, so a failed start there leaves the
 * outline concluded.
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
    return { kind: "plan", concludedAt: now, start: written.start };
  });

  if (prepared.kind === "append") {
    return { concludedAt: prepared.concludedAt, version: prepared.version };
  }
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

type PreparedConclude =
  | { kind: "append"; concludedAt: string; version: number }
  | { kind: "plan"; concludedAt: string; start?: DecomposerStart };

function isAppendIdea(
  idea: IdeaIssue,
): idea is IdeaIssue & { appendTo: string } {
  return Boolean(idea.appendTo);
}

/**
 * Publish the append Idea's unpublished draft as the outline's next version
 * and archive the Idea. Plan settings and `concludedAt` stay as the outline
 * already has them. No session starts.
 */
function concludeAppend(
  idea: IdeaIssue & { appendTo: string },
  outlineId: string,
  verdict: CodeGateVerdict,
  sessions: ConversationMessageSessions,
): PreparedConclude {
  const { issues } = readAll();
  const outline = appendTargetOutline(issues, idea, outlineId);
  refuseIfChannelBusy(outline.id, outlineChannelForRole("decomposer"), sessions);
  const { write, draft } = pendingDraftVersionWrite(outline.id);
  const now = new Date().toISOString();
  const ideaNext = parseStoredIssue({
    ...idea,
    archived: true,
    codeApprovalRequired: verdict === "gated",
    updatedAt: now,
  });
  commitChecked([{ issue: ideaNext }, write], issues);
  removeOutlineDraftIfUnchanged(outline.id, draft);
  return { kind: "append", concludedAt: now, version: write.issue.bodyVersion };
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
