import { ChevronDown, ChevronRight } from "lucide-react";
import type { IssueKind } from "@server/schemas";
import { KIND_LABEL } from "@/features/issues/lib/kind";
import { cn } from "@/lib/utils/cn";
import {
  failedBeatIndex,
  frontierBeatIndex,
  isCollapsedBeat,
  maxSectionBeatEnd,
  OPEN_SPAWN_DASH,
  RETURN_DASH,
  beatStroke,
  displayedDurationMs,
  formatSequenceDuration,
  formatSequenceTokens,
  strokeCss,
  type RunSequence,
  type RunSequenceSection,
  type SequenceBeat,
  type SequenceBeatKind,
  type SequenceBeatTurn,
  type SequenceLifeline,
} from "../run-sequence";

export const ARROW_SIZE = 6;

export type SequenceRenderRow =
  | { kind: "beat"; beat: SequenceBeat; beatIndex: number }
  | { kind: "collapsed"; beat: SequenceBeat; beatIndex: number }
  | { kind: "group_head"; beat: SequenceBeat; beatIndex: number }
  | {
      kind: "turn";
      beat: SequenceBeat;
      beatIndex: number;
      turn: SequenceBeatTurn;
      turnIndex: number;
    };

export function buildSequenceRows(
  beats: SequenceBeat[],
  expanded: ReadonlySet<number>,
): SequenceRenderRow[] {
  const rows: SequenceRenderRow[] = [];
  beats.forEach((beat, beatIndex) => {
    if (isCollapsedBeat(beat) && beat.turns) {
      if (expanded.has(beatIndex)) {
        rows.push({ kind: "group_head", beat, beatIndex });
        beat.turns.forEach((turn, turnIndex) => {
          rows.push({ kind: "turn", beat, beatIndex, turn, turnIndex });
        });
      } else {
        rows.push({ kind: "collapsed", beat, beatIndex });
      }
      return;
    }
    rows.push({ kind: "beat", beat, beatIndex });
  });
  return rows;
}

export function isUnlabeledSection(section: RunSequenceSection): boolean {
  return (
    section.issueId === undefined &&
    section.kind === undefined &&
    section.title === undefined
  );
}

export function sectionKey(section: RunSequenceSection): string {
  return `${section.issueId ?? ""}:${section.beatStart}:${section.beatEnd}`;
}

export type SequenceDisplayItem =
  | {
      kind: "section";
      section: RunSequenceSection;
      key: string;
      depth: number;
      expanded: boolean;
    }
  | { kind: "row"; row: SequenceRenderRow };

/** Interleave section headers with beat rows; collapsed sections hide descendants. */
export function buildSequenceDisplay(
  sections: RunSequenceSection[],
  rows: SequenceRenderRow[],
  collapsed: ReadonlySet<string>,
): SequenceDisplayItem[] {
  if (sections.length === 0) {
    return rows.map((row) => ({ kind: "row" as const, row }));
  }
  const items: SequenceDisplayItem[] = [];
  const rowsByBeat = new Map<number, SequenceRenderRow[]>();
  for (const row of rows) {
    const list = rowsByBeat.get(row.beatIndex);
    if (list) list.push(row);
    else rowsByBeat.set(row.beatIndex, [row]);
  }

  const emitBeat = (beatIndex: number) => {
    const beatRows = rowsByBeat.get(beatIndex);
    if (!beatRows) return;
    for (const row of beatRows) items.push({ kind: "row", row });
  };

  const walk = (nodes: RunSequenceSection[], depth: number) => {
    for (const section of nodes) {
      const unlabeled = isUnlabeledSection(section);
      const key = sectionKey(section);
      const expanded = unlabeled || !collapsed.has(key);
      if (!unlabeled) {
        items.push({ kind: "section", section, key, depth, expanded });
      }
      if (!expanded) continue;
      const children = section.children
        .slice()
        .sort((a, b) => a.beatStart - b.beatStart);
      let beat = section.beatStart;
      let childIdx = 0;
      while (beat <= section.beatEnd) {
        const child = children[childIdx];
        if (child !== undefined && beat === child.beatStart) {
          walk([child], unlabeled ? depth : depth + 1);
          beat = child.beatEnd + 1;
          childIdx += 1;
          continue;
        }
        emitBeat(beat);
        beat += 1;
      }
    }
  };

  walk(sections, 0);

  const uncoveredFrom = maxSectionBeatEnd(sections) + 1;
  const lastBeat = Math.max(-1, ...rowsByBeat.keys());
  for (let index = uncoveredFrom; index <= lastBeat; index += 1) {
    emitBeat(index);
  }

  return items;
}

export function SectionHeader({
  kind,
  title,
  expanded,
  onToggle,
}: {
  kind?: string;
  title?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const kindLabel =
    kind !== undefined && kind in KIND_LABEL
      ? KIND_LABEL[kind as IssueKind]
      : kind;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${[kindLabel, title].filter(Boolean).join(" ")}`}
      data-testid="sequence-section"
      data-kind={kind}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded border px-2 py-1 text-left",
        "border-[hsl(var(--rail))] bg-[hsl(var(--panel))] hover:border-[hsl(var(--rail-lit))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      onClick={onToggle}
    >
      {expanded ? (
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      ) : (
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      {kindLabel ? (
        <span className="shrink-0 font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--current))]">
          {kindLabel}
        </span>
      ) : null}
      {title ? (
        <span
          data-testid="sequence-section-title"
          className="min-w-0 truncate text-[11px] font-medium text-foreground"
        >
          {title}
        </span>
      ) : null}
    </button>
  );
}

export function arrowHeadPoints(
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  size = ARROW_SIZE,
): string {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const base1X = tipX - size * Math.cos(angle) + (size / 2) * Math.sin(angle);
  const base1Y = tipY - size * Math.sin(angle) - (size / 2) * Math.cos(angle);
  const base2X = tipX - size * Math.cos(angle) - (size / 2) * Math.sin(angle);
  const base2Y = tipY - size * Math.sin(angle) + (size / 2) * Math.cos(angle);
  return `${tipX},${tipY} ${base1X},${base1Y} ${base2X},${base2Y}`;
}

export function IterationCountChip({ count }: { count: number }) {
  return (
    <span
      data-testid="sequence-iteration-count"
      className="inline-flex shrink-0 items-center rounded border border-[hsl(var(--rail-lit))] bg-[hsl(var(--panel))] px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums leading-none text-foreground"
    >
      ×{count}
    </span>
  );
}

export function conditionCaption(sequence: RunSequence): string {
  if (sequence.condition === "in-flight") return "updating live";
  if (sequence.condition === "failed") return "failed run";
  return "as-run trace";
}

export type BeatAccent = "live" | "failed" | "indeterminate";

export function beatAccent(
  sequence: RunSequence,
  beatIndex: number,
): BeatAccent | undefined {
  const beat = sequence.beats[beatIndex];
  if (beat?.indeterminate) return "indeterminate";
  if (
    sequence.condition === "failed" &&
    failedBeatIndex(sequence.beats) === beatIndex
  ) {
    return "failed";
  }
  if (frontierBeatIndex(sequence) === beatIndex) return "live";
  return undefined;
}

export function beatCaptionLabel(label: string): string {
  return displayBeatLabel(label);
}

export function DirectedArrow({
  fromX,
  toX,
  y,
  kind,
  accent,
}: {
  fromX: number;
  toX: number;
  y: number;
  kind: SequenceBeatKind;
  accent?: BeatAccent;
}) {
  const isOpen = accent === "live" || accent === "indeterminate";
  const isIndeterminate = accent === "indeterminate";
  const stroke = beatStroke(
    kind,
    accent === "failed" ? "failed" : isOpen ? "live" : undefined,
  );
  const color = strokeCss(stroke.color);
  const tipX = toX;
  const lineEndX = toX - Math.sign(toX - fromX || 1) * ARROW_SIZE;
  const dash = isOpen
    ? OPEN_SPAWN_DASH
    : stroke.dash === "return"
      ? RETURN_DASH
      : undefined;
  const width = isOpen ? 1.75 : stroke.width;
  return (
    <g
      data-testid="sequence-arrow"
      data-kind={kind}
      data-open={isOpen ? "true" : undefined}
      data-indeterminate={isIndeterminate ? "true" : undefined}
    >
      <line
        x1={fromX}
        y1={y}
        x2={lineEndX}
        y2={y}
        stroke={color}
        strokeWidth={width}
        strokeDasharray={dash}
        data-testid="sequence-arrow-shaft"
      />
      {isOpen ? (
        <polygon
          points={arrowHeadPoints(tipX, y, fromX, y)}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          data-testid="sequence-arrow-open-head"
        />
      ) : (
        <polygon
          points={arrowHeadPoints(tipX, y, fromX, y)}
          fill={color}
          data-testid="sequence-arrowhead"
        />
      )}
    </g>
  );
}

/** Server titles are already curated — do not re-strip into kebab. */
export function displayLifelineLabel(line: SequenceLifeline): string {
  return line.label;
}

export function displayBeatLabel(label: string): string {
  return label;
}

export const SEQUENCE_METRIC_COLS = {
  token: "5.5ch",
  duration: "7.5ch",
  cumulative: "7.5ch",
} as const;

export function SequenceMetricCells({
  tokenLabel,
  durationLabel,
  cumulativeLabel,
  isLive,
  isFailed,
  beatIndex,
  rowKind,
}: {
  tokenLabel?: string;
  durationLabel?: string;
  cumulativeLabel?: string;
  isLive: boolean;
  isFailed: boolean;
  beatIndex: number;
  rowKind: string;
}) {
  const color = isFailed
    ? "text-[hsl(var(--blocked))]"
    : isLive
      ? "text-[hsl(var(--current))]"
      : "text-[hsl(var(--mut))]";
  return (
    <span
      data-testid="sequence-metrics"
      data-beat-index={beatIndex}
      data-row={rowKind}
      className={cn(
        "inline-flex shrink-0 items-baseline gap-1.5 font-mono text-[11px] tabular-nums leading-none",
        color,
      )}
    >
      <span
        data-testid="sequence-tokens"
        data-beat-index={beatIndex}
        data-row={rowKind}
        className="shrink-0 whitespace-nowrap text-right"
        style={{ width: SEQUENCE_METRIC_COLS.token }}
      >
        {tokenLabel ?? ""}
      </span>
      <span
        data-testid="sequence-duration"
        data-beat-index={beatIndex}
        data-row={rowKind}
        className="shrink-0 whitespace-nowrap text-right"
        style={{ width: SEQUENCE_METRIC_COLS.duration }}
      >
        {durationLabel ?? ""}
      </span>
      <span
        data-testid="sequence-cumulative"
        data-beat-index={beatIndex}
        data-row={rowKind}
        className="shrink-0 whitespace-nowrap text-right"
        style={{ width: SEQUENCE_METRIC_COLS.cumulative }}
      >
        {cumulativeLabel ?? ""}
      </span>
    </span>
  );
}

export function rowMetricLabels(
  sequence: RunSequence,
  row: SequenceRenderRow,
): {
  token?: string;
  duration?: string;
  cumulative?: string;
  isLive: boolean;
  isFailed: boolean;
} {
  const accent = beatAccent(sequence, row.beatIndex);
  const isLive = accent === "live";
  const isFailed = accent === "failed";
  if (row.kind === "turn") {
    return {
      duration: formatSequenceDuration(row.turn.durationMs),
      isLive: false,
      isFailed: false,
    };
  }
  if (row.kind === "group_head") {
    return { isLive: false, isFailed: false };
  }
  return {
    token: formatSequenceTokens(row.beat.tokenTotal),
    duration: formatSequenceDuration(displayedDurationMs(row.beat, isLive)),
    cumulative: formatSequenceDuration(row.beat.cumulativeMs),
    isLive,
    isFailed,
  };
}
