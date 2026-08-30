import { formatRunDurationMs } from "@/features/issues/components/agent-runs-panel";
import type { RunCondition } from "./run-list";

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
  /** No persisted end and no terminal transcript signal — end cannot be judged. */
  indeterminate?: true;
  /** Stream seq when this beat was appended live; fetched beats omit it. */
  seq?: number;
  /** Elapsed ms from live `subagent_update` frames; does not close the beat. */
  liveElapsedMs?: number;
  /** Model variant when the role name carries a suffix (e.g. composer). */
  variant?: string;
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

/** Greatest `beatEnd` in the section tree; `-1` when there are no sections. */
export function maxSectionBeatEnd(sections: RunSequenceSection[]): number {
  let max = -1;
  for (const section of sections) {
    max = Math.max(max, section.beatEnd, maxSectionBeatEnd(section.children));
  }
  return max;
}

export type BeatStrokeColor = "ink" | "mut" | "rail-lit" | "current" | "blocked";

export type BeatStroke = {
  color: BeatStrokeColor;
  width: number;
  dash?: "return";
};

export const RETURN_DASH = "4 3";
export const LIFELINE_DASH = "4 4";
export const OPEN_TAIL_DASH = "3 4";
export const OPEN_SPAWN_DASH = "5 4";

export function strokeCss(color: BeatStrokeColor): string {
  return `hsl(var(--${color}))`;
}

/** Kind encodings the phone rail must carry unchanged. */
export function beatStroke(
  kind: SequenceBeatKind,
  accent?: "live" | "failed",
): BeatStroke {
  if (accent === "failed") {
    return {
      color: "blocked",
      width: kind === "human-turn" ? 2.5 : 2,
      dash: kind === "return" ? "return" : undefined,
    };
  }
  if (accent === "live") {
    return {
      color: "current",
      width: kind === "human-turn" ? 2.5 : 1.75,
    };
  }
  if (kind === "human-turn") return { color: "ink", width: 2.5 };
  if (kind === "return") return { color: "mut", width: 1.5, dash: "return" };
  return { color: "rail-lit", width: 1.5 };
}

export function isCollapsedBeat(beat: SequenceBeat): boolean {
  return beat.turns !== undefined && beat.turns.length > 1;
}

/** Iteration count as its own datum — never folded into the label. */
export function collapsedIterationCount(beat: SequenceBeat): number | undefined {
  if (!isCollapsedBeat(beat) || beat.turns === undefined) return undefined;
  return beat.turns.length;
}

export type LifelineTail = "extend" | "open-dash" | "stop";

export function lifelineTail(condition: RunCondition): LifelineTail {
  if (condition === "in-flight") return "open-dash";
  if (condition === "failed") return "stop";
  return "extend";
}

export function failedBeatIndex(beats: SequenceBeat[]): number | undefined {
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    if (beats[i]!.label.endsWith(" failed")) return i;
  }
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    if (beats[i]!.kind !== "human-turn") return i;
  }
  return undefined;
}

/** The lifeline that failed — a return leaves it, a spawn enters it. */
export function failedLifelineId(sequence: RunSequence): string | undefined {
  if (sequence.condition !== "failed") return undefined;
  const index = failedBeatIndex(sequence.beats);
  if (index === undefined) return undefined;
  const beat = sequence.beats[index]!;
  return beat.kind === "return" ? beat.from : beat.to;
}

export function frontierBeatIndex(sequence: RunSequence): number | undefined {
  if (sequence.condition !== "in-flight") return undefined;
  for (let i = sequence.beats.length - 1; i >= 0; i -= 1) {
    const beat = sequence.beats[i]!;
    if (beat.kind === "spawn" && beat.durationMs === undefined) return i;
  }
  return undefined;
}

export function displayedDurationMs(
  beat: SequenceBeat,
  isFrontier: boolean,
): number | undefined {
  if (isFrontier && beat.liveElapsedMs !== undefined) return beat.liveElapsedMs;
  return beat.durationMs;
}

export function formatSequenceDuration(
  durationMs: number | undefined,
): string | undefined {
  if (durationMs === undefined) return undefined;
  return formatRunDurationMs(durationMs);
}

/** Compact beat/header token count — `428`, `8.4k`, `184k`, `1.9M`. */
export function formatSequenceTokens(
  tokenTotal: number | undefined,
): string | undefined {
  if (tokenTotal === undefined) return undefined;
  if (tokenTotal < 1000) return String(tokenTotal);
  if (tokenTotal >= 1_000_000) {
    const m = tokenTotal / 1_000_000;
    if (m >= 10 || Number.isInteger(m)) return `${Math.round(m)}M`;
    return `${m.toFixed(1)}M`;
  }
  const k = tokenTotal / 1000;
  if (k >= 10 || Number.isInteger(k)) return `${Math.round(k)}k`;
  return `${k.toFixed(1)}k`;
}

/** Run-header phrase — `184k tokens`. */
export function formatSequenceTokenTotal(
  tokenTotal: number | undefined,
): string | undefined {
  const compact = formatSequenceTokens(tokenTotal);
  if (compact === undefined) return undefined;
  return `${compact} tokens`;
}
