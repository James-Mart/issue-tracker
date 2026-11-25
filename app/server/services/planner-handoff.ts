import { randomUUID } from "node:crypto";
import { outlinePlanningSessionTitle } from "../../src/features/issues/lib/outline-planning-launch.js";
import {
  outlineChannelForRole,
  type ConversationMeta,
  type DelegationRecordWithEnd,
  type OutlineSessionRole,
  type TranscriptEvent,
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
  readTranscriptEventAt,
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
import { concludedOutlineId } from "./concluded-outline.js";
import { IssueError } from "./errors.js";
import { guestRefusesAgentLaunch } from "./guest-agent-launch.js";
import { readAll, readOutlineOrThrow } from "./issues.js";
import { bindCreatedMockupSession } from "./outline-storybook.js";
import { loadRoleModelPin } from "./role-bodies.js";

/** Delegated roles that run the planner (`agents/issue-tracker-planner-*.md`). */
const PLANNER_ROLE_PREFIX = "issue-tracker-planner-";

const MOCKUP_AUTHOR_ROLE = "issue-tracker-mockup-author";

export type PlannerHandoff = {
  outlineId: string;
  /**
   * `fork` continues the Idea's Planning root, which was the planner.
   * `promote` continues the planner that root delegated to.
   */
  mode: "fork" | "promote";
  /** The Idea's Planning root conversation. */
  sourceConversationId: string;
  /**
   * Set for an append whose session forked the outline's planner: that
   * planner and the seq it was forked at, recorded as the new planner's
   * `forkedFrom` in place of the Idea's conversation.
   */
  forkOrigin?: { conversationId: string; seq: number };
};

/** How an outline session gets the context of the agent it continues. */
type AgentContinuation = {
  model: string;
  role?: string;
  copyInto(targetId: string, agentId: string): void;
};

/** An agent the conversation delegated to, and its runs oldest first. */
type DelegatedAgent = {
  agent: DelegationRecordWithEnd;
  runs: DelegationRecordWithEnd[];
};

type OutlineSessions = {
  planner: ConversationMeta;
  ideaId: string | undefined;
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
  const outlineId = concludedOutlineId(issues, idea);
  if (!outlineId) return undefined;
  const { forkedFrom, forkedAtSeq } = meta;
  return {
    outlineId,
    mode: idea.stakeholder ? "promote" : "fork",
    sourceConversationId: meta.id,
    ...(idea.appendTo && forkedFrom !== undefined && forkedAtSeq !== undefined
      ? { forkOrigin: { conversationId: forkedFrom, seq: forkedAtSeq } }
      : {}),
  };
}

/**
 * Continue the planner as the outline's Planning root, from the source
 * conversation through its last transcript event, and archive the source.
 * Earlier planner sessions on the outline are archived. `forkedFrom` is the
 * source, or the handoff's `forkOrigin` when it has one. When the source ran
 * a mockup author, that author continues as the outline's mockups session,
 * bound to the outline's Storybook; earlier mockups sessions are archived.
 */
export async function handoffPlanner(
  handoff: PlannerHandoff,
  sessions: BusyLookup,
): Promise<ConversationMeta> {
  const author = mockupAuthorRuns(
    readConversationMeta(handoff.sourceConversationId),
  );
  const { planner, ideaId } = author
    ? await bindCreatedMockupSession(
        handoff.outlineId,
        () => serialize(() => handOffOutlineSessions(handoff, sessions, author)),
        (created) => created.mockupAuthor.id,
      )
    : await serialize(() => handOffOutlineSessions(handoff, sessions));
  publishPlanningRunIssueFrame(handoff.outlineId);
  if (ideaId) publishPlanningRunIssueFrame(ideaId);
  return planner;
}

function handOffOutlineSessions(
  handoff: PlannerHandoff,
  sessions: BusyLookup,
  author: DelegatedAgent,
): OutlineSessions & { mockupAuthor: ConversationMeta };
function handOffOutlineSessions(
  handoff: PlannerHandoff,
  sessions: BusyLookup,
): OutlineSessions;
function handOffOutlineSessions(
  handoff: PlannerHandoff,
  sessions: BusyLookup,
  author?: DelegatedAgent,
): OutlineSessions {
  const source = readConversationMeta(handoff.sourceConversationId);
  const outline = readOutlineOrThrow(handoff.outlineId);
  const forkedAtSeq = handoffTranscriptSeq(source.id);
  const plannerContinuation =
    handoff.mode === "fork"
      ? forkedPlanner(source, forkedAtSeq)
      : delegatedAgentContinuation(source, plannerRuns(source.id));
  const authorContinuation =
    author && delegatedAgentContinuation(source, author);

  const replacedChannels = authorContinuation
    ? (["mockups", "planning"] as const)
    : (["planning"] as const);
  for (const channel of replacedChannels) {
    for (const existing of channelPredecessors(outline.id, channel)) {
      archiveIdleConversation(existing, sessions);
    }
  }
  const planner = continueOnOutline(plannerContinuation, {
    outline,
    outlineRole: "planner",
    projectId: source.projectId,
    forkedFrom: handoff.forkOrigin?.conversationId ?? source.id,
    forkedAtSeq: handoff.forkOrigin?.seq ?? forkedAtSeq,
  });
  const mockupAuthor =
    authorContinuation &&
    continueOnOutline(authorContinuation, {
      outline,
      outlineRole: "mockup-author",
      projectId: source.projectId,
      forkedFrom: source.id,
      forkedAtSeq,
    });
  archiveIdleConversation(source, sessions);
  return {
    planner,
    ...(mockupAuthor ? { mockupAuthor } : {}),
    ideaId: source.issueId,
  };
}

/** Persist the outline session for `outlineRole` under a fresh agent id. Caller holds `serialize()`. */
function continueOnOutline(
  continuation: AgentContinuation,
  session: {
    outline: { id: string; title: string };
    outlineRole: OutlineSessionRole;
    projectId: string;
    forkedFrom: string;
    forkedAtSeq: number;
  },
): ConversationMeta {
  const { outline, outlineRole } = session;
  const agentId = randomUUID();
  const meta = persistForkedConversation({
    title: outlinePlanningSessionTitle(outlineRole, outline.title),
    projectId: session.projectId,
    model: continuation.model,
    ...(continuation.role ? { role: continuation.role } : {}),
    agentId,
    forkedFrom: session.forkedFrom,
    forkedAtSeq: session.forkedAtSeq,
    anchor: {
      issueId: outline.id,
      channel: outlineChannelForRole(outlineRole),
      outlineRole,
    },
  });
  continuation.copyInto(meta.id, agentId);
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
): AgentContinuation {
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
 * An agent the source delegated to becomes a root agent. Its transcript is
 * the conversation between that agent and whoever delegated to it: each
 * delegated prompt, then the agent's messages in that run.
 */
function delegatedAgentContinuation(
  source: ConversationMeta,
  { agent, runs }: DelegatedAgent,
): AgentContinuation {
  const storeDir = nestedAgentStateDir(source.id, agent.agentId);
  const keepRunId = latestSettledRunId(storeDir);
  const transcript = delegatedTranscript(
    readAllTranscriptEvents(source.id),
    runs,
  );
  return {
    model: loadRoleModelPin(agent.role),
    role: agent.role,
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

/**
 * The last of `candidates` that `matches`, with that agent's runs among
 * `delegations`, or undefined when none matches.
 */
function lastDelegatedAgent(
  delegations: readonly DelegationRecordWithEnd[],
  candidates: readonly DelegationRecordWithEnd[],
  matches: (record: DelegationRecordWithEnd) => boolean,
): DelegatedAgent | undefined {
  const agent = [...candidates].reverse().find(matches);
  if (!agent) return undefined;
  return {
    agent,
    runs: delegations.filter((record) => record.agentId === agent.agentId),
  };
}

/** The planner the conversation delegated to last. */
function plannerRuns(conversationId: string): DelegatedAgent {
  const topLevel = readDelegations(conversationId).filter(
    (record) => record.parentDelegationId === undefined,
  );
  const planner = lastDelegatedAgent(topLevel, topLevel, (record) =>
    record.role.startsWith(PLANNER_ROLE_PREFIX),
  );
  if (!planner) {
    throw new IssueError(
      "validation",
      `conversation "${conversationId}" never delegated to a planner`,
    );
  }
  return planner;
}

/**
 * The mockup author the conversation ran last, at any depth, or undefined
 * when it ran none. Delegations a fork inherited ran on its source, so they
 * do not count; a later run of an inherited author does.
 */
function mockupAuthorRuns(source: ConversationMeta): DelegatedAgent | undefined {
  const delegations = readDelegations(source.id);
  return lastDelegatedAgent(
    delegations,
    ownDelegations(source, delegations),
    (record) => record.role === MOCKUP_AUTHOR_ROLE,
  );
}

/** Delegations recorded after the conversation's fork point; all of them when it is no fork. */
function ownDelegations(
  meta: ConversationMeta,
  delegations: readonly DelegationRecordWithEnd[],
): readonly DelegationRecordWithEnd[] {
  if (meta.forkedAtSeq === undefined) return delegations;
  const forkAt = Date.parse(readTranscriptEventAt(meta.id, meta.forkedAtSeq).at);
  return delegations.filter((record) => Date.parse(record.at) > forkAt);
}

function delegatedTranscript(
  events: readonly SequencedTranscriptEvent[],
  runs: readonly DelegationRecordWithEnd[],
): TranscriptEvent[] {
  const prompts = new Map<string, string>();
  const replies = new Map<string, TranscriptEvent[]>();
  for (const event of events) {
    const call = toolCallOf(event);
    if (call) {
      const args = call.args as { args?: { prompt?: unknown } } | undefined;
      if (typeof args?.args?.prompt === "string") {
        prompts.set(call.callId, args.args.prompt);
      }
    } else if (
      event.type === "subagent_update" &&
      event.delegationId !== undefined &&
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

/** A tool call the root made, or one a delegated agent made. */
function toolCallOf(
  event: SequencedTranscriptEvent,
): { callId: string; args?: unknown } | undefined {
  if (event.type === "tool_call") return event;
  if (event.type === "subagent_update" && event.step.kind === "tool_call") {
    return event.step;
  }
  return undefined;
}
