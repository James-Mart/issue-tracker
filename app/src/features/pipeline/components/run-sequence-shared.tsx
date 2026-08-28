import {
  failedBeatIndex,
  frontierBeatIndex,
  isCollapsedBeat,
  RETURN_DASH,
  beatStroke,
  strokeCss,
  type RunSequence,
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

const INDETERMINATE_DASH = "5 4";
const OPEN_TERMINUS_DASH = "2 2";

export function beatCaptionLabel(beat: SequenceBeat, label: string): string {
  const base = displayBeatLabel(label);
  return beat.indeterminate ? `${base} · no return` : base;
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
  const isIndeterminate = accent === "indeterminate";
  const stroke = beatStroke(
    kind,
    isIndeterminate ? undefined : accent,
  );
  const color = isIndeterminate ? "hsl(var(--warn))" : strokeCss(stroke.color);
  const tipX = toX;
  const lineEndX = isIndeterminate
    ? toX - 12
    : toX - Math.sign(toX - fromX || 1) * ARROW_SIZE;
  const dash = isIndeterminate
    ? INDETERMINATE_DASH
    : stroke.dash === "return"
      ? RETURN_DASH
      : undefined;
  const width = isIndeterminate ? 1.75 : stroke.width;
  return (
    <g
      data-testid="sequence-arrow"
      data-kind={kind}
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
      {isIndeterminate ? (
        <circle
          cx={toX - 8}
          cy={y}
          r={3}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={OPEN_TERMINUS_DASH}
          data-testid="sequence-arrow-open-terminus"
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

export function displayLifelineLabel(line: SequenceLifeline): string {
  if (line.kind !== "role") return line.label;
  return line.label.replace(/^issue-tracker-/, "");
}

export function displayBeatLabel(label: string): string {
  return label.replace(/issue-tracker-/g, "");
}
