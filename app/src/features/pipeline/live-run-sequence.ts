import type {
  AgentRun,
  ConversationStreamEvent,
} from "@server/schemas";
import {
  frontierBeatIndex,
  maxSectionBeatEnd,
  type RunSequence,
  type RunSequenceSection,
  type SequenceBeat,
} from "./run-sequence";

const COORDINATOR_ID = "coordinator";

function elapsedMs(startedAt: string, at: string): number | undefined {
  const ms = Date.parse(at) - Date.parse(startedAt);
  // Live frames validate `at` as a string, not as a date.
  if (Number.isNaN(ms) || ms < 0) return undefined;
  return ms;
}

function compareBeats(a: SequenceBeat, b: SequenceBeat): number {
  if (a.seq !== undefined && b.seq !== undefined && a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  return a.startedAt.localeCompare(b.startedAt);
}

function insertBeat(
  beats: SequenceBeat[],
  beat: SequenceBeat,
): { beats: SequenceBeat[]; index: number } {
  const idx = beats.findIndex((existing) => compareBeats(beat, existing) < 0);
  const at = idx === -1 ? beats.length : idx;
  const next = beats.slice();
  next.splice(at, 0, beat);
  return { beats: next, index: at };
}

function lastLeafPath(sections: RunSequenceSection[]): number[] | undefined {
  if (sections.length === 0) return undefined;
  let bestIdx = 0;
  let bestEnd = sections[0]!.beatEnd;
  for (let i = 1; i < sections.length; i += 1) {
    if (sections[i]!.beatEnd >= bestEnd) {
      bestIdx = i;
      bestEnd = sections[i]!.beatEnd;
    }
  }
  const childPath = lastLeafPath(sections[bestIdx]!.children);
  return childPath ? [bestIdx, ...childPath] : [bestIdx];
}

function findIssuePath(
  sections: RunSequenceSection[],
  issueId: string,
): number[] | undefined {
  let found: number[] | undefined;
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i]!;
    const child = findIssuePath(section.children, issueId);
    if (child) found = [i, ...child];
    else if (section.issueId === issueId) found = [i];
  }
  return found;
}

/** Path from the roots to the section that should absorb an appended beat. */
function pathToExtend(
  sections: RunSequenceSection[],
  issueId?: string,
): number[] | undefined {
  const leaf = lastLeafPath(sections);
  if (!leaf) return undefined;
  if (issueId === undefined) return leaf;

  let nodes = sections;
  let deepest = -1;
  for (let i = 0; i < leaf.length; i += 1) {
    const node = nodes[leaf[i]!]!;
    if (node.issueId === issueId) deepest = i;
    nodes = node.children;
  }
  if (deepest >= 0) return leaf.slice(0, deepest + 1);

  const issuePath = findIssuePath(sections, issueId);
  if (!issuePath) return leaf;
  let common = 0;
  while (
    common < issuePath.length &&
    common < leaf.length &&
    issuePath[common] === leaf[common]
  ) {
    common += 1;
  }
  return common > 0 ? leaf.slice(0, common) : leaf;
}

function shiftSectionRanges(
  sections: RunSequenceSection[],
  at: number,
): RunSequenceSection[] {
  return sections.map((section) => {
    let { beatStart, beatEnd } = section;
    if (beatStart >= at) {
      beatStart += 1;
      beatEnd += 1;
    } else if (beatEnd >= at) {
      beatEnd += 1;
    }
    return {
      ...section,
      beatStart,
      beatEnd,
      children: shiftSectionRanges(section.children, at),
    };
  });
}

function extendAlongPath(
  sections: RunSequenceSection[],
  path: number[],
  beatIndex: number,
): RunSequenceSection[] {
  if (path.length === 0) return sections;
  const [head, ...rest] = path;
  return sections.map((section, i) => {
    if (i !== head) return section;
    return {
      ...section,
      beatEnd: Math.max(section.beatEnd, beatIndex),
      children: extendAlongPath(section.children, rest, beatIndex),
    };
  });
}

function coverInsertedBeat(
  sections: RunSequenceSection[],
  at: number,
  issueId?: string,
): RunSequenceSection[] {
  if (sections.length === 0) return sections;
  if (at <= maxSectionBeatEnd(sections)) return shiftSectionRanges(sections, at);
  const path = pathToExtend(sections, issueId);
  if (!path) return sections;
  return extendAlongPath(sections, path, at);
}

function hasParentCallId(beat: SequenceBeat, callId: string): boolean {
  return beat.parentCallId === callId;
}

function isFailedReturn(beat: SequenceBeat): boolean {
  return beat.kind === "return" && beat.label.endsWith(" failed");
}

function derivedOutcome(beats: SequenceBeat[]): {
  condition: RunSequence["condition"];
  recoveredErrors: number;
} {
  const last = beats[beats.length - 1];
  let condition: RunSequence["condition"];
  if (last !== undefined && isFailedReturn(last)) {
    condition = "failed";
  } else if (
    beats.some(
      (beat) =>
        beat.kind === "spawn" &&
        beat.durationMs === undefined &&
        !beat.indeterminate,
    )
  ) {
    condition = "in-flight";
  } else {
    condition = "completed";
  }

  let recoveredErrors = 0;
  for (let i = 0; i < beats.length - 1; i += 1) {
    if (isFailedReturn(beats[i]!)) recoveredErrors += 1;
  }

  return { condition, recoveredErrors };
}

function withCondition(sequence: RunSequence, beats: SequenceBeat[]): RunSequence {
  const { condition, recoveredErrors } = derivedOutcome(beats);
  return {
    ...sequence,
    beats,
    condition,
    ...(recoveredErrors > 0 ? { recoveredErrors } : {}),
  };
}

function withInsertedBeat(
  sequence: RunSequence,
  beats: SequenceBeat[],
  insertedIndex: number,
  issueId?: string,
): RunSequence {
  const next = withCondition(sequence, beats);
  if (next.sections.length === 0) return next;
  return {
    ...next,
    sections: coverInsertedBeat(next.sections, insertedIndex, issueId),
  };
}

function parentLifelineId(sequence: RunSequence): string {
  const frontier = frontierBeatIndex(sequence);
  if (frontier === undefined) return COORDINATOR_ID;
  return sequence.beats[frontier]!.to;
}

function ensureRoleLifeline(sequence: RunSequence, role: string): RunSequence {
  if (sequence.lifelines.some((line) => line.id === role)) return sequence;
  return {
    ...sequence,
    lifelines: [
      ...sequence.lifelines,
      { id: role, label: role, kind: "role" },
    ],
  };
}

function spawnBeat(run: AgentRun, from: string, seq: number): SequenceBeat {
  return {
    from,
    to: run.role,
    label: `spawn ${run.role}`,
    startedAt: run.startedAt,
    kind: "spawn",
    parentCallId: run.parentCallId,
    seq,
  };
}

function applyDelegation(
  sequence: RunSequence,
  event: Extract<ConversationStreamEvent, { type: "delegation" }>,
): RunSequence {
  const { run } = event;
  if (sequence.beats.some((beat) => hasParentCallId(beat, run.parentCallId))) {
    return sequence;
  }
  const withLifeline = ensureRoleLifeline(sequence, run.role);
  const beat = spawnBeat(run, parentLifelineId(withLifeline), event.seq);
  const inserted = insertBeat(withLifeline.beats, beat);
  return withInsertedBeat(
    withLifeline,
    inserted.beats,
    inserted.index,
    run.issueId,
  );
}

function applyDelegationEnd(
  sequence: RunSequence,
  event: Extract<ConversationStreamEvent, { type: "delegation_end" }>,
): RunSequence {
  const index = sequence.beats.findIndex((beat) =>
    hasParentCallId(beat, event.parentCallId),
  );
  if (index < 0) return sequence;
  const beat = sequence.beats[index]!;
  if (beat.durationMs !== undefined) return sequence;
  const duration = elapsedMs(beat.startedAt, event.endedAt);
  if (duration === undefined) return sequence;

  const { liveElapsedMs: _closedElapsed, ...rest } = beat;
  const closed: SequenceBeat = {
    ...rest,
    durationMs: duration,
  };
  if (closed.turns && closed.turns.length > 0) {
    const turns = closed.turns.slice();
    const last = turns[turns.length - 1]!;
    if (last.durationMs === undefined) {
      const turnDuration = elapsedMs(last.startedAt, event.endedAt);
      turns[turns.length - 1] = {
        ...last,
        ...(turnDuration !== undefined ? { durationMs: turnDuration } : {}),
      };
      closed.turns = turns;
    }
  }

  const beats = sequence.beats.slice();
  beats[index] = closed;
  const role = beat.to;
  const returnBeat: SequenceBeat = {
    from: role,
    to: beat.from,
    label: event.status === "error" ? `${role} failed` : `${role} returned`,
    startedAt: event.endedAt,
    durationMs: duration,
    kind: "return",
    parentCallId: beat.parentCallId,
    seq: event.seq,
  };
  const inserted = insertBeat(beats, returnBeat);
  return withInsertedBeat(sequence, inserted.beats, inserted.index);
}

function applySubagentUpdate(
  sequence: RunSequence,
  event: Extract<ConversationStreamEvent, { type: "subagent_update" }>,
): RunSequence {
  const frontier = frontierBeatIndex(sequence);
  if (frontier === undefined) return sequence;
  const beat = sequence.beats[frontier]!;
  const liveElapsedMs = elapsedMs(beat.startedAt, event.at);
  if (liveElapsedMs === undefined) return sequence;
  if (beat.liveElapsedMs === liveElapsedMs) return sequence;
  const beats = sequence.beats.slice();
  beats[frontier] = { ...beat, liveElapsedMs };
  return { ...sequence, beats };
}

/** Fold one conversation frame onto a fetched (or already-overlaid) sequence. */
export function applyLiveFrame(
  sequence: RunSequence,
  event: ConversationStreamEvent,
): RunSequence {
  if (event.type === "delegation") return applyDelegation(sequence, event);
  if (event.type === "delegation_end") {
    return applyDelegationEnd(sequence, event);
  }
  if (event.type === "subagent_update") {
    return applySubagentUpdate(sequence, event);
  }
  return sequence;
}

/** Insert `event` by `seq`, skipping a duplicate seq. */
export function insertFrameBySeq(
  frames: ConversationStreamEvent[],
  event: ConversationStreamEvent,
): ConversationStreamEvent[] {
  if (frames.some((existing) => existing.seq === event.seq)) return frames;
  const idx = frames.findIndex((existing) => existing.seq > event.seq);
  const at = idx === -1 ? frames.length : idx;
  const next = frames.slice();
  next.splice(at, 0, event);
  return next;
}

export function applyLiveFrames(
  sequence: RunSequence,
  frames: ConversationStreamEvent[],
): RunSequence {
  return frames.reduce(applyLiveFrame, sequence);
}
