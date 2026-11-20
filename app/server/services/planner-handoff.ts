import { randomUUID } from "node:crypto";
import { outlinePlanningSessionTitle } from "../../src/features/issues/lib/outline-planning-launch.js";
import type {
  ConversationMeta,
  DelegationRecordWithEnd,
  TranscriptEvent,
} from "../schemas.js";
import {
  publishPlanningRunIssueFrame,
  type AgentSessions,
} from "./agent-sessions.js";
import {
  agentStateDir,
  copyAgentState,
  copyForkedState,
  latestSettledRunId,
  nestedAgentStateDir,
  resolveForkPoint,
  writeInheritedTranscript,
} from "./conversation-fork.js";
import {
  lastTranscriptSeq,
  readAllTranscriptEvents,
  type SequencedTranscriptEvent,
} from "./conversation-transcript-seq.js";
import {
  appendErrorEvent,
  archiveIdleConversation,
  channelPredecessors,
  persistForkedConversation,
  readConversationMeta,
  readDelegations,
  serialize,
  type BusyLookup,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { guestRefusesAgentLaunch } from "./guest-agent-launch.js";
import { readAll, readOutlineOrThrow } from "./issues.js";
import { loadRoleModelPin } from "./role-bodies.js";

/** Delegated roles that run the planner (`agents/issue-tracker-planner-*.md`). */
const PLANNER_ROLE_PREFIX = "issue-tracker-planner-";

export type PlannerHandoff = {
  outlineId: string;
  /**
   * `fork` continues the Idea's Planning root, which was the planner.
   * `promote` continues the planner that root delegated to.
   */
  mode: "fork" | "promote";
  /** The Idea's Planning root conversation. */
  sourceConversationId: string;
};

/** How the outline's planner session gets the source planner's context. */
type PlannerContinuation = {
  model: string;
  role?: string;
  copyInto(targetId: string, agentId: string): void;
};

/**
 * The handoff a just-settled run owes, if any: the run is on a live Idea
 * Planning conversation whose Idea has concluded onto an outline.
 */
export function concludedPlannerHandoff(
  conversationId: string,
): PlannerHandoff | undefined {
  const meta = readConversationMeta(conversationId);
  if (meta.archived || meta.channel !== "planning" || !meta.issueId) {
    return undefined;
  }
  const { issues } = readAll();
  const idea = issues.find((issue) => issue.id === meta.issueId);
  if (idea?.kind !== "idea" || !idea.archived) return undefined;
  const outline = issues.find(
    (issue) =>
      issue.kind === "outline" &&
      issue.sourceIdea === idea.id &&
      issue.concludedAt !== undefined,
  );
  if (!outline) return undefined;
  return {
    outlineId: outline.id,
    mode: idea.stakeholder ? "promote" : "fork",
    sourceConversationId: meta.id,
  };
}

/**
 * Continue the planner as the outline's Planning root, from the source
 * conversation through its last transcript event, and archive the source.
 * Earlier planner sessions on the outline are archived.
 */
export async function handoffPlanner(
  handoff: PlannerHandoff,
  sessions: BusyLookup,
): Promise<ConversationMeta> {
  const { meta, ideaId } = await serialize(() => {
    const source = readConversationMeta(handoff.sourceConversationId);
    const outline = readOutlineOrThrow(handoff.outlineId);
    const forkedAtSeq = handoffTranscriptSeq(source.id);
    const continuation =
      handoff.mode === "fork"
        ? forkedPlanner(source, forkedAtSeq)
        : promotedPlanner(source);

    for (const existing of channelPredecessors(outline.id, "planning")) {
      archiveIdleConversation(existing, sessions);
    }
    const agentId = randomUUID();
    const meta = persistForkedConversation({
      title: outlinePlanningSessionTitle("planner", outline.title),
      projectId: source.projectId,
      model: continuation.model,
      ...(continuation.role ? { role: continuation.role } : {}),
      agentId,
      forkedFrom: source.id,
      forkedAtSeq,
      anchor: { issueId: outline.id, channel: "planning", outlineRole: "planner" },
    });
    continuation.copyInto(meta.id, agentId);
    archiveIdleConversation(source, sessions);
    return { meta, ideaId: source.issueId };
  });
  publishPlanningRunIssueFrame(handoff.outlineId);
  if (ideaId) publishPlanningRunIssueFrame(ideaId);
  return meta;
}

/** Hand each concluded Idea's planner to its outline when the concluding run ends. */
export function startPlannerHandoffs(sessions: AgentSessions): void {
  sessions.onRunSettled((conversationId) => {
    // Nothing awaits the settle listener; a failed handoff also leaves an error
    // event on the Idea's conversation.
    continueConcludedPlanner(conversationId, sessions).catch((err) => {
      console.error(
        `planner handoff failed for conversation ${conversationId}`,
        err,
      );
    });
  });
}

async function continueConcludedPlanner(
  conversationId: string,
  sessions: AgentSessions,
): Promise<void> {
  // A pending message the settled run handed off keeps the conversation busy;
  // the handoff waits for that run to settle.
  if (guestRefusesAgentLaunch() || sessions.isBusy(conversationId)) return;
  const handoff = concludedPlannerHandoff(conversationId);
  if (!handoff) return;
  try {
    await handoffPlanner(handoff, sessions);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await appendErrorEvent(
      conversationId,
      `The planner did not continue on outline "${handoff.outlineId}": ${reason}`,
    );
    throw err;
  }
}

function handoffTranscriptSeq(conversationId: string): number {
  const seq = lastTranscriptSeq(conversationId);
  if (seq === undefined) {
    throw new IssueError(
      "validation",
      `conversation "${conversationId}" has no transcript to hand off`,
    );
  }
  return seq;
}

function forkedPlanner(
  source: ConversationMeta,
  forkedAtSeq: number,
): PlannerContinuation {
  const { runId } = resolveForkPoint(source.id, forkedAtSeq);
  return {
    model: source.model,
    ...(source.role ? { role: source.role } : {}),
    copyInto(targetId, agentId) {
      copyForkedState({
        sourceId: source.id,
        targetId,
        forkedAtSeq,
        newAgentId: agentId,
        keepRunId: runId,
      });
    },
  };
}

/**
 * The planner the source delegated to becomes a root agent. Its transcript is
 * the conversation between the source and that planner: each delegated
 * prompt, then the planner's messages in that run.
 */
function promotedPlanner(source: ConversationMeta): PlannerContinuation {
  const { planner, runs } = plannerRuns(source.id);
  const storeDir = nestedAgentStateDir(source.id, planner.agentId);
  const keepRunId = latestSettledRunId(storeDir);
  const transcript = plannerTranscript(
    readAllTranscriptEvents(source.id),
    runs,
  );
  return {
    model: loadRoleModelPin(planner.role),
    role: planner.role,
    copyInto(targetId, agentId) {
      copyAgentState({
        sourceDir: storeDir,
        targetDir: agentStateDir(targetId),
        newAgentId: agentId,
        keepRunId,
      });
      writeInheritedTranscript(targetId, transcript);
    },
  };
}

/** The planner the conversation delegated to last, and its runs oldest first. */
function plannerRuns(conversationId: string): {
  planner: DelegationRecordWithEnd;
  runs: DelegationRecordWithEnd[];
} {
  const topLevel = readDelegations(conversationId).filter(
    (record) => record.parentDelegationId === undefined,
  );
  const planner = [...topLevel]
    .reverse()
    .find((record) => record.role.startsWith(PLANNER_ROLE_PREFIX));
  if (!planner) {
    throw new IssueError(
      "validation",
      `conversation "${conversationId}" never delegated to a planner`,
    );
  }
  return {
    planner,
    runs: topLevel.filter((record) => record.agentId === planner.agentId),
  };
}

function plannerTranscript(
  events: readonly SequencedTranscriptEvent[],
  runs: readonly DelegationRecordWithEnd[],
): TranscriptEvent[] {
  const prompts = new Map<string, string>();
  const replies = new Map<string, TranscriptEvent[]>();
  for (const event of events) {
    if (event.type === "tool_call") {
      const call = event.args as { args?: { prompt?: unknown } } | undefined;
      if (typeof call?.args?.prompt === "string") {
        prompts.set(event.callId, call.args.prompt);
      }
    } else if (
      event.type === "subagent_update" &&
      event.delegationId !== undefined &&
      event.parentDelegationId === undefined &&
      event.step.kind === "text"
    ) {
      const runReplies = replies.get(event.delegationId) ?? [];
      runReplies.push({ type: "assistant", text: event.step.text, at: event.at });
      replies.set(event.delegationId, runReplies);
    }
  }

  const transcript = runs.flatMap((run): TranscriptEvent[] => {
    const text = run.parentCallId ? prompts.get(run.parentCallId) : undefined;
    if (text === undefined) {
      throw new IssueError(
        "validation",
        `delegation "${run.delegationId}" has no delegate call with a prompt`,
      );
    }
    return [
      { type: "prompt", text, at: run.at },
      ...(replies.get(run.delegationId) ?? []),
    ];
  });
  return transcript.map((event, index) => ({ ...event, seq: index + 1 }));
}
