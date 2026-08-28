import { ChevronDown, ChevronRight, Loader2, XCircle } from "lucide-react";
import { Rail, RailNode, type RailNodeState } from "@/components/ui/rail";
import { cn } from "@/lib/utils/cn";
import {
  OPEN_TAIL_DASH,
  collapsedIterationCount,
  failedLifelineId,
  displayedDurationMs,
  formatSequenceDuration,
  lifelineTail,
  type RunSequence,
  type SequenceBeatKind,
} from "../run-sequence";
import {
  DirectedArrow,
  IterationCountChip,
  beatAccent,
  displayBeatLabel,
  displayLifelineLabel,
  type SequenceRenderRow,
} from "./run-sequence-shared";

const DURATION_COL = "10ch";

function railState(accent: "live" | "failed" | undefined): RailNodeState {
  if (accent === "live") return "in-flight";
  if (accent === "failed") return "blocked";
  return "ready";
}

function lifelineOf(sequence: RunSequence, id: string) {
  const line = sequence.lifelines.find((candidate) => candidate.id === id);
  if (!line) {
    throw new Error(`unknown sequence lifeline "${id}"`);
  }
  return line;
}

function BeatKindArrow({
  kind,
  accent,
}: {
  kind: SequenceBeatKind;
  accent?: "live" | "failed";
}) {
  return (
    <svg
      viewBox="0 0 100 12"
      className="h-3 min-w-[2.5rem] flex-1"
      aria-hidden
    >
      <DirectedArrow fromX={2} toX={98} y={6} kind={kind} accent={accent} />
    </svg>
  );
}

function RailDuration({
  label,
  isLive,
  isFailed,
  beatIndex,
  rowKind,
}: {
  label: string;
  isLive: boolean;
  isFailed: boolean;
  beatIndex: number;
  rowKind: string;
}) {
  return (
    <span
      data-testid="sequence-duration"
      data-beat-index={beatIndex}
      data-row={rowKind}
      className={cn(
        "shrink-0 whitespace-nowrap text-right font-mono text-[11px] tabular-nums leading-none",
        isFailed
          ? "text-[hsl(var(--blocked))]"
          : isLive
            ? "text-[hsl(var(--current))]"
            : "text-[hsl(var(--mut))]",
      )}
      style={{ width: DURATION_COL }}
    >
      {label}
    </span>
  );
}

function FromTo({
  sequence,
  from,
  to,
  kind,
  accent,
}: {
  sequence: RunSequence;
  from: string;
  to: string;
  kind: SequenceBeatKind;
  accent?: "live" | "failed";
}) {
  return (
    <div className="mt-1 flex min-w-0 flex-1 items-center gap-1.5">
      <span
        data-testid="sequence-from"
        className="min-w-0 max-w-[40%] text-right font-mono text-[10px] leading-snug text-muted-foreground"
      >
        {displayLifelineLabel(lifelineOf(sequence, from))}
      </span>
      <BeatKindArrow kind={kind} accent={accent} />
      <span
        data-testid="sequence-to"
        className="min-w-0 max-w-[40%] font-mono text-[10px] leading-snug text-muted-foreground"
      >
        {displayLifelineLabel(lifelineOf(sequence, to))}
      </span>
    </div>
  );
}

function BeatTitle({
  label,
  isLive,
  isFailed,
}: {
  label: string;
  isLive: boolean;
  isFailed: boolean;
}) {
  return (
    <p
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] font-medium leading-snug",
        isFailed
          ? "text-[hsl(var(--blocked))]"
          : isLive
            ? "text-[hsl(var(--current))]"
            : "text-foreground",
      )}
    >
      <span data-testid="sequence-beat-label">{label}</span>
      {isLive ? (
        <Loader2
          className="h-3 w-3 shrink-0 motion-safe:animate-spin text-[hsl(var(--current))]"
          aria-hidden
        />
      ) : null}
      {isFailed ? (
        <XCircle
          className="h-3 w-3 shrink-0 text-[hsl(var(--blocked))]"
          aria-hidden
        />
      ) : null}
    </p>
  );
}

/** Phone sequence: one beat per Rail row, from/to named, duration gutter. */
export function RunSequenceRail({
  sequence,
  rows,
  onToggle,
}: {
  sequence: RunSequence;
  rows: SequenceRenderRow[];
  onToggle: (beatIndex: number) => void;
}) {
  const tail = lifelineTail(sequence.condition);
  const failedId = failedLifelineId(sequence);
  const hasExpandedTurns = rows.some((row) => row.kind === "turn");

  return (
    <div
      role="img"
      aria-label="Run sequence diagram"
      data-testid="run-sequence-diagram"
      data-condition={sequence.condition}
      data-layout="phone"
      data-tail={tail}
      className="relative min-w-0 px-2 py-2"
    >
      {hasExpandedTurns ? (
        <span
          aria-hidden
          data-testid="sequence-loop-bracket"
          className="pointer-events-none absolute bottom-3 left-1 top-3 w-2.5 rounded-sm border-b-2 border-l-2 border-t-2 border-[hsl(var(--rail-lit))]"
        />
      ) : null}
      <Rail
        live={sequence.condition === "in-flight"}
        className={cn(tail === "extend" && "pb-6")}
      >
        {rows.map((row) => {
          const accent = beatAccent(sequence, row.beatIndex);
          const isLive = accent === "live";
          const isFailed = accent === "failed";
          const count = collapsedIterationCount(row.beat);

          if (row.kind === "group_head") {
            return (
              <div
                key={`head-${row.beatIndex}`}
                data-testid="sequence-group-head"
                data-beat-index={row.beatIndex}
                className="relative flex items-start gap-2 py-2"
              >
                <button
                  type="button"
                  aria-expanded={true}
                  aria-label={`Collapse ${row.beat.label}, ${count} iterations`}
                  className={cn(
                    "flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded border px-2 py-1",
                    "border-[hsl(var(--rail))] bg-[hsl(var(--panel-2))] text-[12px] font-medium text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  onClick={() => onToggle(row.beatIndex)}
                >
                  <ChevronDown
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span>Collapse</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="min-w-0">{displayBeatLabel(row.beat.label)}</span>
                  {count !== undefined ? (
                    <IterationCountChip count={count} />
                  ) : null}
                </button>
                <span
                  className="shrink-0"
                  style={{ width: DURATION_COL }}
                  aria-hidden
                />
              </div>
            );
          }

          const label = displayBeatLabel(
            row.kind === "turn" ? row.turn.label : row.beat.label,
          );
          const duration = formatSequenceDuration(
            row.kind === "turn"
              ? row.turn.durationMs
              : displayedDurationMs(row.beat, isLive),
            row.kind !== "turn" && isLive,
          );

          if (row.kind === "collapsed") {
            return (
              <RailNode
                key={`collapsed-${row.beatIndex}`}
                state={railState(accent)}
                edge="solid"
                data-testid="sequence-beat"
                data-row="collapsed"
                data-kind={row.beat.kind}
                data-from={row.beat.from}
                data-to={row.beat.to}
                data-beat-index={row.beatIndex}
                className="items-start rounded-md border border-[hsl(var(--rail))] bg-[hsl(var(--panel)/0.45)] px-1"
              >
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    aria-expanded={false}
                    aria-label={`Expand ${row.beat.label}, ${count} iterations`}
                    className="min-w-0 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onToggle(row.beatIndex)}
                  >
                    <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] font-medium leading-snug text-foreground">
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span data-testid="sequence-beat-label">{label}</span>
                      {count !== undefined ? (
                        <IterationCountChip count={count} />
                      ) : null}
                    </p>
                  </button>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <FromTo
                      sequence={sequence}
                      from={row.beat.from}
                      to={row.beat.to}
                      kind={row.beat.kind}
                      accent={accent}
                    />
                    {duration ? (
                      <RailDuration
                        label={duration}
                        isLive={false}
                        isFailed={false}
                        beatIndex={row.beatIndex}
                        rowKind="collapsed"
                      />
                    ) : (
                      <span
                        className="shrink-0"
                        style={{ width: DURATION_COL }}
                        aria-hidden
                      />
                    )}
                  </div>
                </div>
              </RailNode>
            );
          }

          return (
            <RailNode
              key={`${row.kind}-${row.beatIndex}-${row.kind === "turn" ? row.turnIndex : "beat"}`}
              state={railState(row.kind === "beat" ? accent : undefined)}
              edge="solid"
              glow={row.kind === "beat" && isLive}
              data-testid="sequence-beat"
              data-row={row.kind}
              data-kind={row.beat.kind}
              data-from={row.beat.from}
              data-to={row.beat.to}
              data-beat-index={row.beatIndex}
              className={cn(
                "items-start",
                row.kind === "turn" &&
                  "border-l-2 border-[hsl(var(--rail-lit))]/80",
              )}
            >
              <div className="min-w-0 flex-1">
                <BeatTitle
                  label={label}
                  isLive={row.kind === "beat" && isLive}
                  isFailed={row.kind === "beat" && isFailed}
                />
                <div className="flex min-w-0 items-center gap-1.5">
                  <FromTo
                    sequence={sequence}
                    from={row.beat.from}
                    to={row.beat.to}
                    kind={row.beat.kind}
                    accent={row.kind === "beat" ? accent : undefined}
                  />
                  {duration ? (
                    <RailDuration
                      label={duration}
                      isLive={row.kind !== "turn" && isLive}
                      isFailed={row.kind !== "turn" && isFailed}
                      beatIndex={row.beatIndex}
                      rowKind={row.kind}
                    />
                  ) : (
                    <span
                      className="shrink-0"
                      style={{ width: DURATION_COL }}
                      aria-hidden
                    />
                  )}
                </div>
                {row.kind === "beat" && isFailed && failedId ? (
                  <span
                    aria-hidden
                    data-testid="sequence-termination-cap"
                    data-lifeline={failedId}
                    className="mt-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-[hsl(var(--blocked))] bg-[hsl(var(--panel-2))]"
                  >
                    <XCircle className="h-3.5 w-3.5 text-[hsl(var(--blocked))]" />
                  </span>
                ) : null}
              </div>
            </RailNode>
          );
        })}
      </Rail>
      {tail === "open-dash" ? (
        <svg
          data-testid="sequence-lifeline-open-tail"
          aria-hidden
          className="ml-[7px] block"
          width="2"
          height="40"
        >
          <line
            x1="1"
            y1="0"
            x2="1"
            y2="40"
            stroke="hsl(var(--rail-lit))"
            strokeWidth={1}
            strokeDasharray={OPEN_TAIL_DASH}
          />
        </svg>
      ) : null}
    </div>
  );
}
