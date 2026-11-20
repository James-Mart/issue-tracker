import { randomUUID } from "node:crypto";
import type { ConversationChannel, ConversationMeta, Issue } from "../schemas.js";
import { appendTargetOutlineId } from "./append-target.js";
import {
  appendForkPrompt,
  copyForkedState,
  copyInheritedHistory,
  resolveForkPoint,
} from "./conversation-fork.js";
import { lastTranscriptSeq } from "./conversation-transcript-seq.js";
import { IssueError } from "./errors.js";
import { activeOutlinePlanner } from "./outline-append-lock.js";
import { readAll } from "./issues.js";

type IdeaIssue = Extract<Issue, { kind: "idea" }>;

type PersistFork = (input: {
  title: string;
  projectId: string;
  model: string;
  agentId: string;
  forkedFrom: string;
  forkedAtSeq: number;
  role?: string;
  anchor?: Pick<ConversationMeta, "issueId" | "channel">;
}) => ConversationMeta;

export type AppendPlanningForkDeps = {
  persist: PersistFork;
};

/**
 * Planning session for an `appendTo` Idea when the target outline has an
 * active planner. The session is a fork of that planner (`forkedFrom` is the
 * planner) and holds its transcript. A stakeholder Idea runs as that
 * stakeholder with a fresh root agent; the inherited transcript is the seed.
 * The source Idea's stakeholder conversation is not read. No planner, or no
 * outline, returns undefined so the caller starts a cold session.
 *
 * Caller holds the conversation `serialize()` turn.
 */
export function forkAppendPlanningSession(
  input: {
    issueId: string;
    channel: ConversationChannel;
    projectId: string;
    title: string;
    initialPrompt?: string;
  },
  deps: AppendPlanningForkDeps,
): ConversationMeta | undefined {
  if (input.channel !== "planning") return undefined;
  const issues = readAll().issues;
  const append = appendIdea(issues, input.issueId);
  if (!append) return undefined;
  const { idea } = append;
  const outlineId = appendTargetOutlineId(issues, append.appendTo);
  if (!outlineId) return undefined;
  const planner = activeOutlinePlanner(outlineId);
  if (!planner) return undefined;

  const forkedAtSeq = forkTranscriptSeq(planner.id);
  const point = settledForkPoint(planner.id, forkedAtSeq);
  // A blank stakeholder is stored as an optional string meaning no stakeholder.
  const stakeholder = idea.stakeholder || undefined;
  const continuePlanner = stakeholder === undefined;
  const agentId = randomUUID();
  const meta = deps.persist({
    title: input.title,
    projectId: input.projectId,
    model: stakeholder ?? planner.model,
    agentId,
    forkedFrom: planner.id,
    forkedAtSeq,
    ...(continuePlanner && planner.role ? { role: planner.role } : {}),
    anchor: { issueId: input.issueId, channel: "planning" },
  });
  if (continuePlanner) {
    copyForkedState({
      sourceId: planner.id,
      targetId: meta.id,
      forkedAtSeq,
      newAgentId: agentId,
      keepRunId: point.runId,
    });
  } else {
    copyInheritedHistory({
      sourceId: planner.id,
      targetId: meta.id,
      forkedAtSeq,
    });
  }
  if (input.initialPrompt) appendForkPrompt(meta.id, input.initialPrompt);
  return meta;
}

function appendIdea(
  issues: readonly Issue[],
  issueId: string,
): { idea: IdeaIssue; appendTo: string } | undefined {
  const issue = issues.find((item) => item.id === issueId);
  if (issue?.kind !== "idea" || !issue.appendTo) return undefined;
  return { idea: issue, appendTo: issue.appendTo };
}

function forkTranscriptSeq(conversationId: string): number {
  const seq = lastTranscriptSeq(conversationId);
  if (seq === undefined) {
    throw new IssueError(
      "validation",
      `conversation "${conversationId}" has no transcript to fork`,
    );
  }
  return seq;
}

function settledForkPoint(
  conversationId: string,
  seq: number,
): { runId: string } {
  try {
    return resolveForkPoint(conversationId, seq);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new IssueError("validation", message);
  }
}
