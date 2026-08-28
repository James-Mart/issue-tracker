import type {
  ConversationMeta,
  DelegationRecord,
  DelegationRecordWithEnd,
  TranscriptEvent,
} from "../schemas.js";
import {
  listConversationIds,
  readConversation,
  readDelegations,
} from "./conversations.js";
import { IssueError } from "./errors.js";

export type RunCondition = "completed" | "in-flight" | "failed";

export type SequenceLifelineKind = "human" | "coordinator" | "role";

export type SequenceBeatKind = "spawn" | "return" | "human-turn";

export type SequenceLifeline = {
  id: string;
  label: string;
  kind: SequenceLifelineKind;
};

export type SequenceBeatTurn = {
  label: string;
  startedAt: string;
  durationMs?: number;
};

export type SequenceBeat = {
  from: string;
  to: string;
  label: string;
  startedAt: string;
  durationMs?: number;
  kind: SequenceBeatKind;
  turns?: SequenceBeatTurn[];
  /** Parent tool call that spawned this beat — used to close it from a live frame. */
  parentCallId?: string;
  /** Predates lifecycle recording — end cannot be judged. */
  indeterminate?: true;
};

export type RunSequence = {
  condition: RunCondition;
  lifelines: SequenceLifeline[];
  beats: SequenceBeat[];
};

export type RecentRun = {
  conversationId: string;
  coordinatorLabel: string;
  startedAt: string;
  condition: RunCondition;
  issueId?: string;
};

const HUMAN_ID = "human";
const COORDINATOR_ID = "coordinator";

type ToolCallEvent = Extract<TranscriptEvent, { type: "tool_call" }>;

type OrderedBeat = {
  beat: SequenceBeat;
  seq?: number;
  at: string;
  open: boolean;
  endedInError: boolean;
};

/** Session-root label: the conversation type on meta, or title when untyped. */
function coordinatorLabel(meta: ConversationMeta): string {
  return meta.channel ?? meta.title;
}

function compareOrder(
  a: { seq?: number; at: string },
  b: { seq?: number; at: string },
): number {
  if (a.seq !== undefined && b.seq !== undefined && a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  return a.at.localeCompare(b.at);
}

function durationMs(startedAt: string, endedAt: string): number {
  return Date.parse(endedAt) - Date.parse(startedAt);
}

function earliestCallEvent(
  parentCallId: string,
  toolCalls: ToolCallEvent[],
): ToolCallEvent | undefined {
  let best: ToolCallEvent | undefined;
  for (const event of toolCalls) {
    if (event.callId !== parentCallId) continue;
    if (!best || compareOrder(event, best) < 0) best = event;
  }
  return best;
}

function parentLifelineId(
  record: DelegationRecord,
  byId: Map<string, DelegationRecordWithEnd>,
  conversationId: string,
): string {
  const parentId = record.parentDelegationId;
  if (parentId === undefined) return COORDINATOR_ID;
  const parent = byId.get(parentId);
  if (!parent) {
    throw new IssueError(
      "validation",
      `delegation "${record.delegationId}" parent "${parentId}" is not in conversation "${conversationId}"`,
    );
  }
  return parent.role;
}

function closedDuration(
  startedAt: string,
  endedAt: string,
): Pick<SequenceBeat, "durationMs"> {
  return { durationMs: durationMs(startedAt, endedAt) };
}

function runCondition(beats: OrderedBeat[]): RunCondition {
  if (beats.some((row) => row.endedInError)) return "failed";
  if (beats.some((row) => row.open)) return "in-flight";
  return "completed";
}

function turnEndMs(beat: SequenceBeat, row: OrderedBeat): number {
  if (beat.durationMs !== undefined) {
    return Date.parse(beat.startedAt) + beat.durationMs;
  }
  return Date.parse(row.at);
}

function groupParentCallId(group: OrderedBeat[]): string | undefined {
  const open = [...group].reverse().find((row) => row.open);
  if (open?.beat.parentCallId !== undefined) return open.beat.parentCallId;
  for (let i = group.length - 1; i >= 0; i -= 1) {
    const id = group[i]!.beat.parentCallId;
    if (id !== undefined) return id;
  }
  return undefined;
}

function collapseGroup(group: OrderedBeat[]): OrderedBeat {
  if (group.length === 1) return group[0]!;

  const first = group[0]!;
  const turns: SequenceBeatTurn[] = group.map((row) => ({
    label: row.beat.label,
    startedAt: row.beat.startedAt,
    ...(row.beat.durationMs !== undefined
      ? { durationMs: row.beat.durationMs }
      : {}),
  }));

  const anyOpen = group.some((row) => row.open);
  const indeterminate = group.some((row) => row.beat.indeterminate);
  let durationMs: number | undefined;
  if (!anyOpen && !indeterminate) {
    const firstStart = Date.parse(first.beat.startedAt);
    let latestEnd = firstStart;
    for (const row of group) {
      latestEnd = Math.max(latestEnd, turnEndMs(row.beat, row));
    }
    durationMs = latestEnd - firstStart;
  }
  const parentCallId = groupParentCallId(group);

  return {
    beat: {
      from: first.beat.from,
      to: first.beat.to,
      label: first.beat.label,
      startedAt: first.beat.startedAt,
      kind: first.beat.kind,
      turns,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(parentCallId !== undefined ? { parentCallId } : {}),
      ...(indeterminate ? { indeterminate: true } : {}),
    },
    seq: first.seq,
    at: first.at,
    open: anyOpen,
    endedInError: group.some((row) => row.endedInError),
  };
}

/** Merge consecutive beats that share the same lifeline pair. */
function collapseConsecutiveBeats(rows: OrderedBeat[]): OrderedBeat[] {
  if (rows.length === 0) return [];

  const collapsed: OrderedBeat[] = [];
  let group: OrderedBeat[] = [rows[0]!];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const anchor = group[0]!;
    if (row.beat.from === anchor.beat.from && row.beat.to === anchor.beat.to) {
      group.push(row);
      continue;
    }
    collapsed.push(collapseGroup(group));
    group = [row];
  }

  collapsed.push(collapseGroup(group));
  return collapsed;
}

/** One conversation's lifelines, ordered beats, and derived condition. */
export function runSequence(conversationId: string): RunSequence {
  const { meta, transcript } = readConversation(conversationId);
  const delegations = readDelegations(conversationId);
  const toolCalls = transcript.filter(
    (e): e is ToolCallEvent => e.type === "tool_call",
  );
  const prompts = transcript.filter((e) => e.type === "prompt");
  const byId = new Map(delegations.map((row) => [row.delegationId, row]));

  const ordered: OrderedBeat[] = [];

  for (const prompt of prompts) {
    ordered.push({
      beat: {
        from: HUMAN_ID,
        to: COORDINATOR_ID,
        label: "human replied",
        startedAt: prompt.at,
        kind: "human-turn",
      },
      seq: prompt.seq,
      at: prompt.at,
      open: false,
      endedInError: false,
    });
  }

  for (const record of delegations) {
    const from = parentLifelineId(record, byId, conversationId);
    const to = record.role;
    const startEvent =
      record.parentCallId !== undefined
        ? earliestCallEvent(record.parentCallId, toolCalls)
        : undefined;
    const end = record.end;
    const closed = end !== undefined;
    const indeterminate = !closed && record.lifecycle !== "tracked";
    const endedInError = end?.status === "error";

    ordered.push({
      beat: {
        from,
        to,
        label: `spawn ${record.role}`,
        startedAt: record.at,
        kind: "spawn",
        ...(closed ? closedDuration(record.at, end.endedAt) : {}),
        ...(record.parentCallId !== undefined
          ? { parentCallId: record.parentCallId }
          : {}),
        ...(indeterminate ? { indeterminate: true } : {}),
      },
      seq: startEvent?.seq,
      at: startEvent?.at ?? record.at,
      open: !closed && !indeterminate,
      endedInError,
    });

    if (!closed) continue;

    ordered.push({
      beat: {
        from: to,
        to: from,
        label:
          end.status === "error"
            ? `${record.role} failed`
            : `${record.role} returned`,
        startedAt: end.endedAt,
        kind: "return",
        ...closedDuration(record.at, end.endedAt),
      },
      at: end.endedAt,
      open: false,
      endedInError,
    });
  }

  ordered.sort(compareOrder);
  const collapsed = collapseConsecutiveBeats(ordered);

  const roleIds: string[] = [];
  for (const record of delegations) {
    if (!roleIds.includes(record.role)) roleIds.push(record.role);
  }

  const lifelines: SequenceLifeline[] = [];
  if (prompts.length > 0) {
    lifelines.push({ id: HUMAN_ID, label: "human", kind: "human" });
  }
  lifelines.push({
    id: COORDINATOR_ID,
    label: coordinatorLabel(meta),
    kind: "coordinator",
  });
  for (const role of roleIds) {
    lifelines.push({ id: role, label: role, kind: "role" });
  }

  return {
    condition: runCondition(ordered),
    lifelines,
    beats: collapsed.map((row) => row.beat),
  };
}

function earliestIssueId(delegations: DelegationRecord[]): string | undefined {
  let earliest: DelegationRecord | undefined;
  for (const record of delegations) {
    if (record.issueId === undefined) continue;
    if (!earliest || record.at.localeCompare(earliest.at) < 0) {
      earliest = record;
    }
  }
  return earliest?.issueId;
}

/** Newest-first runs across all conversations; scan stays in this function. */
export function recentRuns(limit: number): RecentRun[] {
  const entries: RecentRun[] = [];

  for (const conversationId of listConversationIds()) {
    try {
      const { meta } = readConversation(conversationId);
      const delegations = readDelegations(conversationId);
      const sequence = runSequence(conversationId);
      const issueId = earliestIssueId(delegations);
      entries.push({
        conversationId,
        coordinatorLabel: coordinatorLabel(meta),
        startedAt: meta.createdAt,
        condition: sequence.condition,
        ...(issueId !== undefined ? { issueId } : {}),
      });
    } catch {
      continue;
    }
  }

  entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return entries.slice(0, limit);
}
