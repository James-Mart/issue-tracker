import {
  roleFamily,
  roleFamilyCaption,
  roleFamilyTitle,
} from "@/features/pipeline/role-family";
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
  readConversationMeta,
  readDelegations,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { readAll, readIssueOrThrow } from "./issues.js";
import { isRunLive } from "./run-live.js";

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
  /** No persisted end and no terminal transcript signal — end cannot be judged. */
  indeterminate?: true;
  /** Sum of attributed `usage.totalTokens` for this beat. */
  tokenTotal?: number;
  /** Wall-clock ms from run start to this closed beat's end. */
  cumulativeMs?: number;
};

export type RunSequenceRootIssue = {
  id: string;
  kind: string;
  title: string;
  projectId: string;
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
  /** Sum of every persisted `usage.totalTokens` on the conversation. */
  tokenTotal?: number;
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
type SubagentUpdateEvent = Extract<TranscriptEvent, { type: "subagent_update" }>;

type TranscriptClose = {
  endedAt: string;
  endedInError: boolean;
};

type OrderedBeat = {
  beat: SequenceBeat;
  seq?: number;
  at: string;
  open: boolean;
  endedInError: boolean;
  issueId?: string;
  endedAt?: string;
};

type UsageEvent = Extract<TranscriptEvent, { type: "usage" }>;

type IssueAncestry = {
  issueId: string;
  kind: string;
  title: string;
};

/** Seat title: planning → Stakeholder, implementing → Coordinator, else title. */
function coordinatorLabel(meta: ConversationMeta): string {
  if (meta.channel === "planning") return "Stakeholder";
  if (meta.channel === "implementing") return "Coordinator";
  return meta.title;
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

function isTerminalToolStatus(
  status: ToolCallEvent["status"],
): status is "completed" | "error" {
  return status === "completed" || status === "error";
}

function subagentUpdateMatchesSpawn(
  event: SubagentUpdateEvent,
  record: DelegationRecord,
): boolean {
  if (event.delegationId === record.delegationId) return true;
  return (
    record.parentCallId !== undefined &&
    event.parentCallId === record.parentCallId
  );
}

/** Latest terminal transcript signal for a spawn that has no persisted end. */
function terminalTranscriptClose(
  record: DelegationRecord,
  transcript: TranscriptEvent[],
): TranscriptClose | undefined {
  let best: { at: string; seq?: number; endedInError: boolean } | undefined;
  for (const event of transcript) {
    if (event.type === "tool_call") {
      if (
        record.parentCallId === undefined ||
        event.callId !== record.parentCallId ||
        !isTerminalToolStatus(event.status)
      ) {
        continue;
      }
      const row = {
        at: event.at,
        seq: event.seq,
        endedInError: event.status === "error",
      };
      if (!best || compareOrder(best, row) < 0) best = row;
      continue;
    }
    if (event.type !== "subagent_update") continue;
    if (!subagentUpdateMatchesSpawn(event, record)) continue;
    if (event.step.kind !== "tool_call") continue;
    if (!isTerminalToolStatus(event.step.status)) continue;
    const row = {
      at: event.at,
      seq: event.seq,
      endedInError: event.step.status === "error",
    };
    if (!best || compareOrder(best, row) < 0) best = row;
  }
  if (best === undefined) return undefined;
  return { endedAt: best.at, endedInError: best.endedInError };
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

function spawnLabel(caption: string): string {
  return `spawn ${caption}`;
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

export function conditionWithLiveness(
  conversationId: string,
  beatCondition: RunCondition,
): RunCondition {
  return isRunLive(conversationId) ? "in-flight" : beatCondition;
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
  let tokenTotal = 0;
  let hasTokens = false;
  for (const row of group) {
    if (row.beat.tokenTotal === undefined) continue;
    tokenTotal += row.beat.tokenTotal;
    hasTokens = true;
  }
  let endedAt: string | undefined;
  let cumulativeMs: number | undefined;
  if (!anyOpen && !indeterminate) {
    for (const row of group) {
      if (row.endedAt === undefined) continue;
      if (endedAt === undefined || row.endedAt.localeCompare(endedAt) > 0) {
        endedAt = row.endedAt;
      }
      if (
        row.beat.cumulativeMs !== undefined &&
        (cumulativeMs === undefined || row.beat.cumulativeMs > cumulativeMs)
      ) {
        cumulativeMs = row.beat.cumulativeMs;
      }
    }
  }

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
      ...(hasTokens ? { tokenTotal } : {}),
      ...(cumulativeMs !== undefined ? { cumulativeMs } : {}),
    },
    seq: first.seq,
    at: first.at,
    open: anyOpen,
    endedInError: group.some((row) => row.endedInError),
    ...(first.issueId !== undefined ? { issueId: first.issueId } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
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
  sessionIssueId?: string,
): RunSequenceSection[] {
  const roots: RunSequenceSection[] = [];
  const stack: RunSequenceSection[] = [];
  let leading: RunSequenceSection | undefined;

  for (let i = 0; i < rows.length; i += 1) {
    const issueId = sessionIssueId ?? rows[i]!.issueId;
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

function orderedBeats(
  conversationId: string,
  transcript: TranscriptEvent[],
  delegations: DelegationRecordWithEnd[],
): OrderedBeat[] {
  const toolCalls = transcript.filter(
    (e): e is ToolCallEvent => e.type === "tool_call",
  );
  const byId = new Map(delegations.map((row) => [row.delegationId, row]));
  const ordered: OrderedBeat[] = [];

  for (const prompt of transcript) {
    if (prompt.type !== "prompt") continue;
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
      endedAt: prompt.at,
    });
  }

  for (const record of delegations) {
    const { family, variant, caption } = roleFamilyCaption(record.role);
    const from = parentLifelineId(record, byId, conversationId);
    const to = family;
    const startEvent =
      record.parentCallId !== undefined
        ? earliestCallEvent(record.parentCallId, toolCalls)
        : undefined;
    const end = record.end;
    const transcriptClose =
      end === undefined
        ? terminalTranscriptClose(record, transcript)
        : undefined;
    const endedAt = end?.endedAt ?? transcriptClose?.endedAt;
    const closed = endedAt !== undefined;
    const indeterminate = !closed && record.lifecycle !== "tracked";
    const endedInError =
      end !== undefined
        ? end.status === "error"
        : (transcriptClose?.endedInError ?? false);

    ordered.push({
      beat: {
        from,
        to,
        label: spawnLabel(caption),
        startedAt: record.at,
        kind: "spawn",
        ...(variant !== undefined ? { variant } : {}),
        ...(endedAt !== undefined ? closedDuration(record.at, endedAt) : {}),
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
      ...(endedAt !== undefined ? { endedAt } : {}),
    });

    if (endedAt === undefined || !endedInError) continue;

    ordered.push({
      beat: {
        from: to,
        to: from,
        label: `${caption} failed`,
        startedAt: endedAt,
        kind: "return",
        ...(variant !== undefined ? { variant } : {}),
        ...closedDuration(record.at, endedAt),
      },
      at: endedAt,
      open: false,
      endedInError,
      ...(record.issueId !== undefined ? { issueId: record.issueId } : {}),
      endedAt,
    });
  }

  ordered.sort(compareOrder);
  return ordered;
}

function addTokenTotal(row: OrderedBeat, tokens: number): void {
  row.beat.tokenTotal = (row.beat.tokenTotal ?? 0) + tokens;
}

function enclosingHumanTurn(
  rows: OrderedBeat[],
  event: UsageEvent,
): OrderedBeat | undefined {
  let best: OrderedBeat | undefined;
  for (const row of rows) {
    if (row.beat.kind !== "human-turn") continue;
    if (compareOrder(row, event) > 0) continue;
    if (!best || compareOrder(row, best) > 0) best = row;
  }
  return best;
}

function attributeUsage(
  rows: OrderedBeat[],
  transcript: TranscriptEvent[],
): number | undefined {
  let tokenTotal = 0;
  let sawUsage = false;
  for (const event of transcript) {
    if (event.type !== "usage") continue;
    sawUsage = true;
    const tokens = event.usage.totalTokens;
    tokenTotal += tokens;
    if (event.parentCallId !== undefined) {
      const spawn = rows.find(
        (row) =>
          row.beat.kind === "spawn" &&
          row.beat.parentCallId === event.parentCallId,
      );
      if (spawn) addTokenTotal(spawn, tokens);
      continue;
    }
    const human = enclosingHumanTurn(rows, event);
    if (human) addTokenTotal(human, tokens);
  }
  return sawUsage ? tokenTotal : undefined;
}

function stampCumulativeMs(rows: OrderedBeat[], runStartMs: number): void {
  for (const row of rows) {
    if (row.endedAt === undefined) continue;
    row.beat.cumulativeMs = Date.parse(row.endedAt) - runStartMs;
  }
}

/** One conversation's lifelines, ordered beats, and derived condition. */
export function runSequence(conversationId: string): RunSequence {
  const { meta, transcript } = readConversation(conversationId);
  const delegations = readDelegations(conversationId);
  const prompts = transcript.filter((e) => e.type === "prompt");
  const ordered = orderedBeats(conversationId, transcript, delegations);
  const usageTotal = attributeUsage(ordered, transcript);
  stampCumulativeMs(ordered, Date.parse(meta.createdAt));
  const collapsed = collapseConsecutiveBeats(ordered);
  const sessionIssueId =
    meta.channel === "planning" && meta.issueId !== undefined
      ? meta.issueId
      : undefined;
  const sections = buildSections(collapsed, issuesById(), sessionIssueId);

  const familyIds: string[] = [];
  for (const record of delegations) {
    const { family } = roleFamily(record.role);
    if (!familyIds.includes(family)) familyIds.push(family);
  }

  const lifelines: SequenceLifeline[] = [];
  if (prompts.length > 0) {
    lifelines.push({ id: HUMAN_ID, label: "Human", kind: "human" });
  }
  lifelines.push({
    id: COORDINATOR_ID,
    label: coordinatorLabel(meta),
    kind: "coordinator",
  });
  for (const family of familyIds) {
    lifelines.push({
      id: family,
      label: roleFamilyTitle(family),
      kind: "role",
    });
  }

  const { condition: beatCondition, recoveredErrors } = runOutcome(ordered);
  const rootIssue = resolveRootIssue(delegations, meta);

  return {
    condition: conditionWithLiveness(conversationId, beatCondition),
    lifelines,
    beats: collapsed.map((row) => row.beat),
    sections,
    ...(recoveredErrors > 0 ? { recoveredErrors } : {}),
    ...(rootIssue !== undefined ? { rootIssue } : {}),
    ...(usageTotal !== undefined ? { tokenTotal: usageTotal } : {}),
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

function projectIdOfIssue(
  issue: Issue,
  byId: Map<string, Issue>,
): string | undefined {
  let current: Issue | undefined = issue;
  const seen = new Set<string>();
  while (current !== undefined) {
    if (current.kind === "project") return current.id;
    if (seen.has(current.id)) return undefined;
    seen.add(current.id);
    current = byId.get(current.partOf);
  }
  return undefined;
}

function runIssueId(
  meta: ConversationMeta,
  delegations: DelegationRecord[],
): string | undefined {
  if (meta.channel === "planning" && meta.issueId !== undefined) {
    return meta.issueId;
  }
  return earliestIssueId(delegations);
}

function resolveRootIssue(
  delegations: DelegationRecord[],
  meta: ConversationMeta,
): RunSequenceRootIssue | undefined {
  const issueId = runIssueId(meta, delegations);
  if (issueId === undefined) return undefined;
  try {
    const issue = readIssueOrThrow(issueId);
    const projectId = projectIdOfIssue(issue, issuesById());
    if (projectId === undefined) return undefined;
    return { id: issueId, kind: issue.kind, title: issue.title, projectId };
  } catch (err) {
    if (err instanceof IssueError && err.code === "not_found") return undefined;
    throw err;
  }
}

function runCursorKey(createdAt: string, conversationId: string): string {
  return `${createdAt}|${conversationId}`;
}

function parseRunCursor(cursor: string): {
  createdAt: string;
  conversationId: string;
} {
  const sep = cursor.indexOf("|");
  if (sep <= 0 || sep === cursor.length - 1) {
    throw new IssueError("validation", "cursor must be createdAt|conversationId");
  }
  return {
    createdAt: cursor.slice(0, sep),
    conversationId: cursor.slice(sep + 1),
  };
}

function compareRecentRunMeta(a: ConversationMeta, b: ConversationMeta): number {
  const byCreated = b.createdAt.localeCompare(a.createdAt);
  if (byCreated !== 0) return byCreated;
  return b.id.localeCompare(a.id);
}

/** True when `meta` is strictly after `cursor` in newest-first, id-desc order. */
function isAfterRunCursor(
  meta: ConversationMeta,
  cursor: { createdAt: string; conversationId: string },
): boolean {
  const byCreated = meta.createdAt.localeCompare(cursor.createdAt);
  if (byCreated !== 0) return byCreated < 0;
  return meta.id.localeCompare(cursor.conversationId) < 0;
}

/** Newest-first page; hydrate transcript and delegations only for the page slice. */
export function recentRunsPage(options: {
  limit: number;
  cursor?: string;
}): { runs: RecentRun[]; nextCursor: string | null } {
  const parsedCursor =
    options.cursor === undefined ? undefined : parseRunCursor(options.cursor);

  const metas: ConversationMeta[] = [];
  for (const conversationId of listConversationIds()) {
    try {
      metas.push(readConversationMeta(conversationId));
    } catch {
      continue;
    }
  }
  metas.sort(compareRecentRunMeta);

  const afterCursor =
    parsedCursor === undefined
      ? metas
      : metas.filter((meta) => isAfterRunCursor(meta, parsedCursor));
  const pageMetas = afterCursor.slice(0, options.limit);

  const runs: RecentRun[] = [];
  for (const listed of pageMetas) {
    try {
      const { meta, transcript } = readConversation(listed.id);
      const delegations = readDelegations(listed.id);
      const { condition: beatCondition, recoveredErrors } = runOutcome(
        orderedBeats(listed.id, transcript, delegations),
      );
      const issueId = runIssueId(meta, delegations);
      runs.push({
        conversationId: listed.id,
        coordinatorLabel: coordinatorLabel(meta),
        startedAt: meta.createdAt,
        condition: conditionWithLiveness(listed.id, beatCondition),
        ...(issueId !== undefined ? { issueId } : {}),
        ...(recoveredErrors > 0 ? { recoveredErrors } : {}),
      });
    } catch {
      continue;
    }
  }

  const last = runs[runs.length - 1];
  const nextCursor =
    last === undefined || afterCursor.length <= options.limit
      ? null
      : runCursorKey(last.startedAt, last.conversationId);
  return { runs, nextCursor };
}
