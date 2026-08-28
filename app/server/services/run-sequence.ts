import { roleFamily } from "@/features/pipeline/role-family";
import type {
  ConversationMeta,
  DelegationRecord,
  DelegationRecordWithEnd,
  Issue,
  TranscriptEvent,
} from "../schemas.js";
import {
  listConversationIds,
  readConversation,
  readDelegations,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { readAll, readIssueOrThrow } from "./issues.js";

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
  /** Model variant when the role name carries a suffix (e.g. composer). */
  variant?: string;
  /** Parent tool call that spawned this beat — used to close it from a live frame. */
  parentCallId?: string;
  /** Predates lifecycle recording — end cannot be judged. */
  indeterminate?: true;
};

export type RunSequenceRootIssue = {
  id: string;
  kind: string;
  title: string;
};

export type RunSequenceSection = {
  issueId?: string;
  kind?: string;
  title?: string;
  beatStart: number;
  beatEnd: number;
  children: RunSequenceSection[];
};

export type RunSequence = {
  condition: RunCondition;
  lifelines: SequenceLifeline[];
  beats: SequenceBeat[];
  sections: RunSequenceSection[];
  recoveredErrors?: number;
  rootIssue?: RunSequenceRootIssue;
};

export type RecentRun = {
  conversationId: string;
  coordinatorLabel: string;
  startedAt: string;
  condition: RunCondition;
  issueId?: string;
  recoveredErrors?: number;
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
  issueId?: string;
};

type IssueAncestry = {
  issueId: string;
  kind: string;
  title: string;
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
  return roleFamily(parent.role).family;
}

function roleCaption(family: string, variant?: string): string {
  return variant ? `${family} (${variant})` : family;
}

function spawnLabel(family: string, variant?: string): string {
  return `spawn ${roleCaption(family, variant)}`;
}

function returnLabel(
  family: string,
  variant: string | undefined,
  failed: boolean,
): string {
  const role = roleCaption(family, variant);
  return failed ? `${role} failed` : `${role} returned`;
}

function closedDuration(
  startedAt: string,
  endedAt: string,
): Pick<SequenceBeat, "durationMs"> {
  return { durationMs: durationMs(startedAt, endedAt) };
}

function runOutcome(beats: OrderedBeat[]): {
  condition: RunCondition;
  recoveredErrors: number;
} {
  const last = beats[beats.length - 1];
  let condition: RunCondition;
  if (last?.beat.kind === "return" && last.endedInError) {
    condition = "failed";
  } else if (beats.some((row) => row.open)) {
    condition = "in-flight";
  } else {
    condition = "completed";
  }

  let recoveredErrors = 0;
  for (let i = 0; i < beats.length - 1; i += 1) {
    const row = beats[i]!;
    if (row.beat.kind === "return" && row.endedInError) recoveredErrors += 1;
  }

  return { condition, recoveredErrors };
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
    ...(first.issueId !== undefined ? { issueId: first.issueId } : {}),
  };
}

function sameCollapseAnchor(row: OrderedBeat, anchor: OrderedBeat): boolean {
  return (
    row.beat.from === anchor.beat.from &&
    row.beat.to === anchor.beat.to &&
    row.issueId === anchor.issueId
  );
}

/** Merge consecutive beats that share the same lifeline pair and issue. */
function collapseConsecutiveBeats(rows: OrderedBeat[]): OrderedBeat[] {
  if (rows.length === 0) return [];

  const collapsed: OrderedBeat[] = [];
  let group: OrderedBeat[] = [rows[0]!];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const anchor = group[0]!;
    if (sameCollapseAnchor(row, anchor)) {
      group.push(row);
      continue;
    }
    collapsed.push(collapseGroup(group));
    group = [row];
  }

  collapsed.push(collapseGroup(group));
  return collapsed;
}

function issuesById(): Map<string, Issue> {
  return new Map(readAll().issues.map((issue) => [issue.id, issue]));
}

function issueAncestry(
  issueId: string,
  byId: Map<string, Issue>,
): IssueAncestry[] | undefined {
  const issue = byId.get(issueId);
  if (issue === undefined) return undefined;

  const chain: IssueAncestry[] = [];
  const seen = new Set<string>();
  let current: Issue | undefined = issue;
  while (current !== undefined && current.kind !== "project") {
    // readAll() can include a cyclic partOf; stop rather than walk forever.
    if (seen.has(current.id)) break;
    seen.add(current.id);
    chain.push({
      issueId: current.id,
      kind: current.kind,
      title: current.title,
    });
    current = byId.get(current.partOf);
  }
  chain.reverse();
  return chain.length > 0 ? chain : undefined;
}

function openSection(
  roots: RunSequenceSection[],
  stack: RunSequenceSection[],
  index: number,
  node?: IssueAncestry,
): RunSequenceSection {
  const section: RunSequenceSection = {
    ...(node !== undefined
      ? { issueId: node.issueId, kind: node.kind, title: node.title }
      : {}),
    beatStart: index,
    beatEnd: index,
    children: [],
  };
  const parent = stack[stack.length - 1];
  if (parent === undefined) roots.push(section);
  else parent.children.push(section);
  stack.push(section);
  return section;
}

function extendOpen(stack: RunSequenceSection[], index: number): void {
  for (const section of stack) {
    section.beatEnd = index;
  }
}

/** Nested issue sections over collapsed beats; untagged beats join the open section. */
function buildSections(
  rows: OrderedBeat[],
  byId: Map<string, Issue>,
): RunSequenceSection[] {
  const roots: RunSequenceSection[] = [];
  const stack: RunSequenceSection[] = [];
  let leading: RunSequenceSection | undefined;

  for (let i = 0; i < rows.length; i += 1) {
    const issueId = rows[i]!.issueId;
    const ancestry =
      issueId !== undefined ? issueAncestry(issueId, byId) : undefined;

    if (ancestry === undefined) {
      if (stack.length === 0) {
        leading = openSection(roots, stack, i);
      } else {
        extendOpen(stack, i);
      }
      continue;
    }

    if (stack.length === 1 && stack[0] === leading) {
      stack.pop();
    }

    let common = 0;
    while (
      common < stack.length &&
      common < ancestry.length &&
      stack[common]!.issueId === ancestry[common]!.issueId
    ) {
      common += 1;
    }
    stack.length = common;
    for (let depth = common; depth < ancestry.length; depth += 1) {
      openSection(roots, stack, i, ancestry[depth]);
    }
    extendOpen(stack, i);
  }

  return roots;
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
    const { family, variant } = roleFamily(record.role);
    const from = parentLifelineId(record, byId, conversationId);
    const to = family;
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
        label: spawnLabel(family, variant),
        startedAt: record.at,
        kind: "spawn",
        ...(variant !== undefined ? { variant } : {}),
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
      ...(record.issueId !== undefined ? { issueId: record.issueId } : {}),
    });

    if (!closed) continue;

    ordered.push({
      beat: {
        from: to,
        to: from,
        label: returnLabel(family, variant, end.status === "error"),
        startedAt: end.endedAt,
        kind: "return",
        ...(variant !== undefined ? { variant } : {}),
        ...closedDuration(record.at, end.endedAt),
      },
      at: end.endedAt,
      open: false,
      endedInError,
      ...(record.issueId !== undefined ? { issueId: record.issueId } : {}),
    });
  }

  ordered.sort(compareOrder);
  const collapsed = collapseConsecutiveBeats(ordered);
  const sections = buildSections(collapsed, issuesById());

  const familyIds: string[] = [];
  for (const record of delegations) {
    const { family } = roleFamily(record.role);
    if (!familyIds.includes(family)) familyIds.push(family);
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
  for (const family of familyIds) {
    lifelines.push({ id: family, label: family, kind: "role" });
  }

  const { condition, recoveredErrors } = runOutcome(ordered);
  const rootIssue = resolveRootIssue(delegations);

  return {
    condition,
    lifelines,
    beats: collapsed.map((row) => row.beat),
    sections,
    ...(recoveredErrors > 0 ? { recoveredErrors } : {}),
    ...(rootIssue !== undefined ? { rootIssue } : {}),
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

function resolveRootIssue(
  delegations: DelegationRecord[],
): RunSequenceRootIssue | undefined {
  const issueId = earliestIssueId(delegations);
  if (issueId === undefined) return undefined;
  try {
    const issue = readIssueOrThrow(issueId);
    return { id: issueId, kind: issue.kind, title: issue.title };
  } catch (err) {
    if (err instanceof IssueError && err.code === "not_found") return undefined;
    throw err;
  }
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
        ...(sequence.recoveredErrors !== undefined
          ? { recoveredErrors: sequence.recoveredErrors }
          : {}),
      });
    } catch {
      continue;
    }
  }

  entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return entries.slice(0, limit);
}
