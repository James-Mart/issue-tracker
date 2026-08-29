import { useMemo, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  UserRound,
  XCircle,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils/cn";
import { RunSequenceRail } from "./run-sequence-rail";
import {
  LIFELINE_DASH,
  OPEN_TAIL_DASH,
  collapsedIterationCount,
  failedBeatIndex,
  failedLifelineId,
  displayedDurationMs,
  formatSequenceDuration,
  isCollapsedBeat,
  lifelineTail,
  type RunSequence,
  type SequenceLifeline,
  type SequenceLifelineKind,
} from "../run-sequence";
import {
  DirectedArrow,
  IterationCountChip,
  SectionHeader,
  beatAccent,
  beatCaptionLabel,
  buildSequenceDisplay,
  buildSequenceRows,
  displayBeatLabel,
  displayLifelineLabel,
} from "./run-sequence-shared";

export const DESKTOP_SEQUENCE_METRICS = {
  padLeft: 56,
  padRight: 12,
  padTop: 20,
  padBottom: 24,
  lifelineHeader: 56,
  rowHeight: 48,
  sectionHeaderHeight: 36,
  lifelineGap: 116,
  labelW: 88,
  durationCol: 68,
  openTail: 40,
  failedCap: 20,
} as const;

type Metrics = typeof DESKTOP_SEQUENCE_METRICS;

export function lifelineX(
  index: number,
  count: number,
  metrics: Metrics = DESKTOP_SEQUENCE_METRICS,
): number {
  const graphLeft = metrics.padLeft + metrics.labelW / 2;
  if (count <= 1) return graphLeft;
  const graphRight =
    metrics.padLeft + metrics.labelW / 2 + (count - 1) * metrics.lifelineGap;
  return graphLeft + (index / (count - 1)) * (graphRight - graphLeft);
}

export function sequenceDiagramWidth(
  count: number,
  metrics: Metrics = DESKTOP_SEQUENCE_METRICS,
): number {
  const graphSpan = Math.max(0, count - 1) * metrics.lifelineGap + metrics.labelW;
  return Math.max(400, metrics.padLeft + graphSpan + metrics.padRight);
}

export function rowCenterY(
  rowIndex: number,
  metrics: Metrics = DESKTOP_SEQUENCE_METRICS,
): number {
  return (
    metrics.padTop +
    metrics.lifelineHeader +
    rowIndex * metrics.rowHeight +
    metrics.rowHeight / 2
  );
}

export { arrowHeadPoints, buildSequenceRows } from "./run-sequence-shared";

function LifelineGlyph({ kind }: { kind: SequenceLifelineKind }) {
  const cls = "h-4 w-4 shrink-0 text-muted-foreground";
  if (kind === "human") return <UserRound className={cls} aria-hidden />;
  if (kind === "coordinator") return <Bot className={cls} aria-hidden />;
  return <Circle className={cls} aria-hidden />;
}

function LoopBracket({
  fromX,
  toX,
  topY,
  bottomY,
}: {
  fromX: number;
  toX: number;
  topY: number;
  bottomY: number;
}) {
  const left = Math.min(fromX, toX) - 10;
  const right = Math.max(fromX, toX) + 10;
  const cap = 8;
  return (
    <g data-testid="sequence-loop-bracket">
      <path
        d={`M ${left + cap} ${topY} H ${left} V ${bottomY} H ${left + cap}`}
        fill="none"
        stroke="hsl(var(--rail-lit))"
        strokeWidth={1.5}
      />
      <path
        d={`M ${right - cap} ${topY} H ${right} V ${bottomY} H ${right - cap}`}
        fill="none"
        stroke="hsl(var(--rail-lit))"
        strokeWidth={1.5}
      />
    </g>
  );
}

function BeatLabel({
  label,
  x,
  y,
  isLive,
  isFailed,
  isIndeterminate,
}: {
  label: string;
  x: number;
  y: number;
  isLive: boolean;
  isFailed: boolean;
  isIndeterminate: boolean;
}) {
  return (
    <span
      className={cn(
        "absolute z-10 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium leading-none",
        "bg-[hsl(var(--panel-2))]",
        isIndeterminate
          ? "text-[hsl(var(--warn))]"
          : isLive
            ? "text-[hsl(var(--current))]"
            : "text-foreground",
        isFailed && "text-[hsl(var(--blocked))]",
      )}
      style={{ left: x, top: y - 20 }}
      data-testid="sequence-beat-label"
    >
      {isLive && !isIndeterminate ? (
        <Loader2
          className="h-3 w-3 shrink-0 motion-safe:animate-spin text-[hsl(var(--current))]"
          aria-hidden
        />
      ) : null}
      {label}
      {isFailed ? (
        <XCircle
          className="h-3 w-3 shrink-0 text-[hsl(var(--blocked))]"
          aria-hidden
        />
      ) : null}
    </span>
  );
}

function DurationGutter({
  label,
  x,
  y,
  width,
  isLive,
  isFailed,
  beatIndex,
  rowKind,
}: {
  label: string;
  x: number;
  y: number;
  width: number;
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
        "absolute z-10 overflow-hidden whitespace-nowrap font-mono text-[11px] tabular-nums leading-none",
        isFailed
          ? "text-[hsl(var(--blocked))]"
          : isLive
            ? "text-[hsl(var(--current))]"
            : "text-[hsl(var(--mut))]",
      )}
      style={{ top: y - 6, left: x, width, textAlign: "right" }}
    >
      {label}
    </span>
  );
}

function headerBorder(kind: SequenceLifelineKind): string {
  if (kind === "human") return "border-[hsl(var(--ink))]";
  if (kind === "coordinator") return "border-[hsl(var(--current)/0.5)]";
  return "border-[hsl(var(--rail))]";
}

/** Sequence diagram: lifelines at desktop width, Rail at phone width. */
export function RunSequenceDiagram({
  sequence,
  className,
  layout,
}: {
  sequence: RunSequence;
  className?: string;
  layout?: "desktop" | "phone";
}) {
  const isMobile = useIsMobile();
  const resolvedLayout = layout ?? (isMobile ? "phone" : "desktop");
  const [loopExpanded, setLoopExpanded] = useState<Set<number>>(
    () => new Set(),
  );
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(),
  );
  const metrics = DESKTOP_SEQUENCE_METRICS;
  const rows = useMemo(
    () => buildSequenceRows(sequence.beats, loopExpanded),
    [sequence.beats, loopExpanded],
  );
  const displayItems = useMemo(
    () => buildSequenceDisplay(sequence.sections, rows, collapsedSections),
    [sequence.sections, rows, collapsedSections],
  );
  const placed = useMemo(() => {
    let yCursor = metrics.padTop + metrics.lifelineHeader;
    return displayItems.map((item) => {
      if (item.kind === "section") {
        const y = yCursor + metrics.sectionHeaderHeight / 2;
        yCursor += metrics.sectionHeaderHeight;
        return { ...item, y };
      }
      const y = yCursor + metrics.rowHeight / 2;
      yCursor += metrics.rowHeight;
      return { ...item, y };
    });
  }, [displayItems, metrics]);
  const placedRows = placed.filter(
    (item): item is Extract<(typeof placed)[number], { kind: "row" }> =>
      item.kind === "row",
  );
  const toggle = (beatIndex: number) => {
    setLoopExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(beatIndex)) next.delete(beatIndex);
      else next.add(beatIndex);
      return next;
    });
  };
  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const indexById = new Map(
    sequence.lifelines.map((line, index) => [line.id, index]),
  );
  const tail = lifelineTail(sequence.condition);
  const failedId = failedLifelineId(sequence);
  const failedIndex = failedBeatIndex(sequence.beats);
  const width = sequenceDiagramWidth(sequence.lifelines.length);
  const lastBeatY =
    placedRows.length > 0
      ? placedRows[placedRows.length - 1]!.y
      : metrics.padTop + metrics.lifelineHeader;
  const failedPlaced = placedRows.find(
    (item) =>
      item.row.kind !== "group_head" && item.row.beatIndex === failedIndex,
  );
  const failedBeatY = failedPlaced?.y ?? lastBeatY;
  const contentBottom =
    metrics.padTop +
    metrics.lifelineHeader +
    displayItems.reduce(
      (sum, item) =>
        sum +
        (item.kind === "section"
          ? metrics.sectionHeaderHeight
          : metrics.rowHeight),
      0,
    );
  // Failed condition is "any error," not a terminal cut: later beats stay.
  // The stop tail contrasts completed's post-last-beat extension; the cap
  // marks the failed lifeline at the error beat.
  const height =
    contentBottom +
    (tail === "stop"
      ? metrics.failedCap
      : metrics.padBottom + (tail === "open-dash" ? metrics.openTail : 0));
  const defaultEndY =
    tail === "stop"
      ? lastBeatY + 12
      : tail === "open-dash"
        ? lastBeatY
        : height - metrics.padBottom;

  const xFor = (id: string): number => {
    const index = indexById.get(id);
    if (index === undefined) {
      throw new Error(`unknown sequence lifeline "${id}"`);
    }
    return lifelineX(index, sequence.lifelines.length);
  };

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        resolvedLayout === "phone" ? "flex-none" : "flex-1",
        className,
      )}
    >
      <div
        className={cn(
          "relative min-w-0 rounded-lg border border-border bg-[hsl(var(--panel)/0.35)]",
          resolvedLayout === "phone"
            ? "overflow-visible"
            : "min-h-[16rem] flex-1 overflow-auto shell:min-h-[calc(100svh-14rem)]",
        )}
        data-testid="run-sequence-frame"
      >
        {resolvedLayout === "phone" ? (
          <RunSequenceRail
            sequence={sequence}
            displayItems={displayItems}
            onToggle={toggle}
            onToggleSection={toggleSection}
          />
        ) : (
        <div className="flex min-w-0" style={{ minHeight: height }}>
        <div
          role="img"
          aria-label="Run sequence diagram"
          data-testid="run-sequence-diagram"
          data-condition={sequence.condition}
          data-layout="desktop"
          data-tail={tail}
          className="relative shrink-0"
          style={{ width, height }}
        >
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="absolute inset-0 block"
            aria-hidden
          >
            {sequence.lifelines.map((line, i) => {
              const x = lifelineX(i, sequence.lifelines.length);
              return (
                <g
                  key={line.id}
                  data-testid="sequence-lifeline"
                  data-id={line.id}
                  data-kind={line.kind}
                  data-tail={tail}
                  data-y1={metrics.padTop + metrics.lifelineHeader}
                  data-y2={defaultEndY}
                >
                  <line
                    x1={x}
                    y1={metrics.padTop + metrics.lifelineHeader}
                    x2={x}
                    y2={defaultEndY}
                    stroke="hsl(var(--rail))"
                    strokeWidth={1}
                    strokeDasharray={LIFELINE_DASH}
                    data-testid="sequence-lifeline-body"
                  />
                  {tail === "open-dash" ? (
                    <line
                      x1={x}
                      y1={defaultEndY}
                      x2={x}
                      y2={height - metrics.padBottom + metrics.openTail - 8}
                      stroke="hsl(var(--rail-lit))"
                      strokeWidth={1}
                      strokeDasharray={OPEN_TAIL_DASH}
                      data-testid="sequence-lifeline-open-tail"
                    />
                  ) : null}
                </g>
              );
            })}
            {placedRows.map((item, rowIndex) => {
              if (item.row.kind === "group_head") return null;
              const accent = beatAccent(sequence, item.row.beatIndex);
              return (
                <DirectedArrow
                  key={`${item.row.kind}-${item.row.beatIndex}-${rowIndex}`}
                  fromX={xFor(item.row.beat.from)}
                  toX={xFor(item.row.beat.to)}
                  y={item.y}
                  kind={item.row.beat.kind}
                  accent={accent}
                />
              );
            })}
            {sequence.beats.map((beat, beatIndex) => {
              if (!loopExpanded.has(beatIndex) || !isCollapsedBeat(beat)) {
                return null;
              }
              const turnYs = placedRows
                .filter(
                  (item) =>
                    item.row.kind === "turn" && item.row.beatIndex === beatIndex,
                )
                .map((item) => item.y);
              if (turnYs.length === 0) return null;
              return (
                <LoopBracket
                  key={`bracket-${beatIndex}`}
                  fromX={xFor(beat.from)}
                  toX={xFor(beat.to)}
                  topY={turnYs[0]!}
                  bottomY={turnYs[turnYs.length - 1]!}
                />
              );
            })}
          </svg>

          {sequence.lifelines.map((line, i) => {
            const x = lifelineX(i, sequence.lifelines.length);
            return (
              <LifelineHeader
                key={line.id}
                line={line}
                x={x}
                metrics={metrics}
              />
            );
          })}

          {placed.map((item) => {
            if (item.kind !== "section") return null;
            const indent = item.depth * 16;
            return (
              <div
                key={item.key}
                className="absolute z-20"
                style={{
                  left: metrics.padLeft + indent,
                  top: item.y - 14,
                  width: width - metrics.padLeft - metrics.padRight - indent,
                }}
              >
                <SectionHeader
                  kind={item.section.kind}
                  title={item.section.title}
                  expanded={item.expanded}
                  onToggle={() => toggleSection(item.key)}
                />
              </div>
            );
          })}

          {tail === "stop" && failedId ? (
            <span
              aria-hidden
              data-testid="sequence-termination-cap"
              data-lifeline={failedId}
              className="absolute z-10 flex -translate-x-1/2 items-center justify-center"
              style={{ left: xFor(failedId), top: failedBeatY + 8 }}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[hsl(var(--blocked))] bg-[hsl(var(--panel-2))]">
                <XCircle className="h-3.5 w-3.5 text-[hsl(var(--blocked))]" />
              </span>
            </span>
          ) : null}

          {placedRows.map((item, rowIndex) => {
            const row = item.row;
            const y = item.y;
            const fromX = xFor(row.beat.from);
            const toX = xFor(row.beat.to);
            const midX = (fromX + toX) / 2;
            const accent = beatAccent(sequence, row.beatIndex);
            const isLive = accent === "live";
            const isFailed = accent === "failed";
            const isIndeterminate = accent === "indeterminate";
            const count = collapsedIterationCount(row.beat);

            if (row.kind === "collapsed") {
              return (
                <div
                  key={`collapsed-${row.beatIndex}`}
                  data-testid="sequence-beat"
                  data-row="collapsed"
                  data-kind={row.beat.kind}
                  data-from={row.beat.from}
                  data-to={row.beat.to}
                  data-beat-index={row.beatIndex}
                  data-y={y}
                >
                  <button
                    type="button"
                    aria-expanded={false}
                    aria-label={`Expand ${row.beat.label}, ${count} iterations`}
                    className={cn(
                      "absolute z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded border px-2 py-0.5",
                      "border-[hsl(var(--rail))] bg-[hsl(var(--panel-2))] hover:border-[hsl(var(--rail-lit))]",
                      "text-[11px] font-medium",
                      isIndeterminate
                        ? "text-[hsl(var(--warn))]"
                        : "text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    style={{ left: midX, top: y - 20 }}
                    onClick={() => toggle(row.beatIndex)}
                  >
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span data-testid="sequence-beat-label">
                      {beatCaptionLabel(row.beat, row.beat.label)}
                    </span>
                    {count !== undefined ? (
                      <IterationCountChip count={count} />
                    ) : null}
                  </button>
                </div>
              );
            }

            if (row.kind === "group_head") {
              return (
                <div
                  key={`head-${row.beatIndex}`}
                  data-testid="sequence-group-head"
                  data-beat-index={row.beatIndex}
                >
                  <button
                    type="button"
                    aria-expanded={true}
                    aria-label={`Collapse ${row.beat.label}, ${count} iterations`}
                    className={cn(
                      "absolute z-20 flex items-center gap-2 whitespace-nowrap rounded border px-2 py-0.5",
                      "border-[hsl(var(--rail))] bg-[hsl(var(--panel-2))] text-[11px] font-medium text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    style={{
                      top: y - 10,
                      left: Math.min(fromX, toX) - 10,
                    }}
                    onClick={() => toggle(row.beatIndex)}
                  >
                    <ChevronDown
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span>Collapse</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="max-w-[14rem] truncate">
                      {displayBeatLabel(row.beat.label)}
                    </span>
                    {count !== undefined ? (
                      <IterationCountChip count={count} />
                    ) : null}
                  </button>
                </div>
              );
            }

            const label = beatCaptionLabel(
              row.beat,
              row.kind === "turn" ? row.turn.label : row.beat.label,
            );
            return (
              <div
                key={`${row.kind}-${row.beatIndex}-${rowIndex}`}
                data-testid="sequence-beat"
                data-row={row.kind}
                data-kind={row.beat.kind}
                data-from={row.beat.from}
                data-to={row.beat.to}
                data-beat-index={row.beatIndex}
                data-y={y}
              >
                <BeatLabel
                  label={label}
                  x={midX}
                  y={y}
                  isLive={row.kind === "beat" && isLive}
                  isFailed={row.kind === "beat" && isFailed}
                  isIndeterminate={row.kind === "beat" && isIndeterminate}
                />
              </div>
            );
          })}
        </div>
        <div
          data-testid="sequence-duration-gutter"
          className="sticky right-0 z-20 shrink-0 border-l border-[hsl(var(--rail))] bg-[hsl(var(--panel)/0.92)] relative"
          style={{ width: metrics.durationCol, height }}
        >
          {placedRows.map((item, rowIndex) => {
            const row = item.row;
            const y = item.y;
            const accent = beatAccent(sequence, row.beatIndex);
            const isLive = accent === "live";
            const isFailed = accent === "failed";
            if (row.kind === "group_head") return null;
            const duration = formatSequenceDuration(
              row.kind === "turn"
                ? row.turn.durationMs
                : displayedDurationMs(row.beat, isLive),
            );
            if (!duration) return null;
            return (
              <DurationGutter
                key={`${row.kind}-${row.beatIndex}-${rowIndex}`}
                label={duration}
                x={8}
                y={y}
                width={metrics.durationCol - 16}
                isLive={row.kind !== "turn" && isLive}
                isFailed={row.kind !== "turn" && isFailed}
                beatIndex={row.beatIndex}
                rowKind={row.kind}
              />
            );
          })}
        </div>
        </div>
        )}
      </div>
    </div>
  );
}

function LifelineHeader({
  line,
  x,
  metrics,
}: {
  line: SequenceLifeline;
  x: number;
  metrics: Metrics;
}) {
  return (
    <div
      data-testid="sequence-lifeline-header"
      data-id={line.id}
      data-kind={line.kind}
      data-x={x}
      className="absolute z-10 flex flex-col items-center gap-1"
      style={{
        left: x - metrics.labelW / 2,
        top: metrics.padTop,
        width: metrics.labelW,
      }}
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md border bg-[hsl(var(--panel-2))]",
          headerBorder(line.kind),
        )}
      >
        <LifelineGlyph kind={line.kind} />
      </span>
      <span
        className="w-full truncate text-center font-mono text-[10px] leading-tight text-muted-foreground"
        title={line.label}
      >
        {displayLifelineLabel(line)}
      </span>
    </div>
  );
}
