import { ExternalLink, UserRound } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  layoutPipelineDiagram,
  type PlacedPipelineNode,
} from "./pipeline-layout";
import type {
  Pipeline,
  PipelineEdge,
  PipelineId,
  PipelineNode,
} from "./shape";

const ARROW_LEN = 6;

function forwardEdgePath(
  from: PlacedPipelineNode,
  to: PlacedPipelineNode,
  cardH: number,
): string {
  const yStart = from.y + cardH / 2;
  const yEnd = to.y - cardH / 2 - ARROW_LEN;
  if (Math.abs(to.x - from.x) <= 0.5) {
    return `M ${from.x} ${yStart} L ${from.x} ${yEnd}`;
  }
  const busY = yStart + (yEnd - yStart) * 0.38;
  return `M ${from.x} ${yStart} L ${from.x} ${busY} L ${to.x} ${busY} L ${to.x} ${yEnd}`;
}

function loopArcPath(
  from: PlacedPipelineNode,
  to: PlacedPipelineNode,
  gutterX: number,
  cardH: number,
): string {
  const startX = from.x - from.cardW / 2;
  const startY = from.y + cardH / 2;
  const tipY = to.y - cardH / 2;
  const endY = tipY - 2;
  // First control holds y so the run reaches the gutter before climbing;
  // the vertical segment stays beside the layers, not through them.
  return `M ${startX} ${startY} C ${gutterX} ${startY}, ${gutterX} ${endY}, ${to.x} ${endY}`;
}

function HollowPort({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      data-testid="pipeline-step-port"
      className={cn(
        "h-3 w-3 shrink-0 rounded-full border-2",
        selected
          ? "border-[hsl(var(--current))] bg-[hsl(var(--current))] [box-shadow:var(--glow)]"
          : "border-[hsl(var(--ink))] bg-[hsl(var(--void))]",
      )}
    />
  );
}

function PipelineNodeCard({
  node,
  label,
  compact,
  dense,
  selected,
}: {
  node: PipelineNode;
  label: string;
  compact: boolean;
  dense: boolean;
  selected: boolean;
}) {
  const labelClass = cn(
    "min-w-0 font-medium",
    dense
      ? "text-center text-[10px] leading-tight break-words"
      : "text-xs leading-snug",
  );
  const pad = dense
    ? "justify-center px-1 py-1"
    : compact
      ? "gap-1.5 px-2 py-2"
      : "gap-2 px-3 py-2";
  const current =
    "border-[hsl(var(--current))] [box-shadow:var(--glow)]";

  if (node.kind === "gate") {
    // Attention hue waits for a published waiting-on-person state.
    return (
      <div
        className={cn(
          "flex h-full w-full items-center rounded-none border-[3px] border-double bg-card",
          selected ? current : "border-foreground",
          pad,
        )}
      >
        {dense ? null : (
          <UserRound
            aria-hidden
            data-testid="pipeline-gate-glyph"
            className={cn(
              "h-4 w-4 shrink-0",
              selected ? "text-[hsl(var(--current))]" : "text-muted-foreground",
            )}
          />
        )}
        <span
          className={cn(
            labelClass,
            selected ? "text-[hsl(var(--current))]" : "text-foreground",
          )}
        >
          {label}
        </span>
      </div>
    );
  }

  if (node.kind === "handoff") {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center rounded-md border border-dashed border-[hsl(var(--rail-lit))] bg-[hsl(var(--panel))]",
          pad,
        )}
      >
        {dense ? null : (
          <ExternalLink
            aria-hidden
            data-testid="pipeline-handoff-glyph"
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
        )}
        <span className={cn(labelClass, "text-muted-foreground")}>{label}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full items-center rounded-md border bg-card",
        selected ? current : "border-border",
        pad,
      )}
    >
      {dense ? null : <HollowPort selected={selected} />}
      <span
        className={cn(
          labelClass,
          selected ? "text-[hsl(var(--current))]" : "text-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/** One declared pipeline, layered by the generalized graph layout. */
export function PipelineDiagram({
  pipeline,
  className,
  containerWidth,
  selectedStepId,
  onSelectStep,
  onHandoff,
}: {
  pipeline: Pipeline;
  className?: string;
  containerWidth?: number;
  selectedStepId?: string;
  onSelectStep?: (stepId: string) => void;
  onHandoff?: (targetPipeline: PipelineId) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(
    undefined,
  );

  useLayoutEffect(() => {
    if (containerWidth != null) return;
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const next = width > 0 ? width : undefined;
      setMeasuredWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerWidth]);

  const layout = layoutPipelineDiagram(
    pipeline,
    containerWidth ?? measuredWidth,
  );
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const loopEdges = layout.edges.filter((edge) => edge.kind === "loop");
  const markerId = `pipeline-arrow-${pipeline.id}`;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`${pipeline.title} diagram`}
      data-testid="pipeline-diagram"
      data-pipeline={pipeline.id}
      data-layout={layout.compact ? "phone" : "desktop"}
      className={cn(
        "relative w-full overflow-x-auto rounded-md border border-border bg-[hsl(var(--panel)/0.35)]",
        className,
      )}
    >
      <div
        className="relative"
        style={{ width: layout.width, height: layout.height }}
      >
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="absolute inset-0 block"
          aria-hidden
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 7"
              refX="9"
              refY="3.5"
              markerWidth="8"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 0 L 10 3.5 L 0 7 z" fill="context-stroke" />
            </marker>
          </defs>
          {layout.edges.map((edge: PipelineEdge) => {
            const from = byId.get(edge.from)!;
            const to = byId.get(edge.to)!;
            const isLoop = edge.kind === "loop";
            const loopIndex = isLoop
              ? loopEdges.findIndex(
                  (candidate) =>
                    candidate.from === edge.from && candidate.to === edge.to,
                )
              : 0;
            const gutterX =
              layout.padX + layout.loopGutter * 0.42 - loopIndex * 14;
            const d = isLoop
              ? loopArcPath(from, to, gutterX, layout.cardH)
              : forwardEdgePath(from, to, layout.cardH);
            return (
              <path
                key={`${edge.from}->${edge.to}:${edge.kind}`}
                d={d}
                fill="none"
                stroke={isLoop ? "hsl(var(--mut))" : "hsl(var(--rail-lit))"}
                strokeWidth={1.75}
                strokeDasharray={isLoop ? "4 3" : undefined}
                markerEnd={`url(#${markerId})`}
                data-testid="pipeline-edge"
                data-from={edge.from}
                data-to={edge.to}
                data-kind={edge.kind}
              />
            );
          })}
        </svg>
        {layout.nodes.map((node) => {
          const selected = selectedStepId === node.id;
          const card = (
            <PipelineNodeCard
              node={node}
              label={node.label}
              compact={layout.compact}
              dense={node.dense}
              selected={selected}
            />
          );
          const boxStyle = {
            left: node.x - node.cardW / 2,
            top: node.y - layout.cardH / 2,
            width: node.cardW,
            height: layout.cardH,
          };
          if (node.kind === "handoff" && onHandoff) {
            return (
              <button
                key={node.id}
                type="button"
                data-testid="pipeline-node"
                data-id={node.id}
                data-kind={node.kind}
                data-label={node.label}
                data-target-pipeline={node.targetPipeline}
                className="absolute text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={boxStyle}
                onClick={() => onHandoff(node.targetPipeline)}
              >
                {card}
              </button>
            );
          }
          if (node.kind !== "handoff" && onSelectStep) {
            return (
              <button
                key={node.id}
                type="button"
                data-testid="pipeline-node"
                data-id={node.id}
                data-kind={node.kind}
                data-label={node.label}
                data-current={selected ? "true" : undefined}
                aria-pressed={selected}
                aria-controls={selected ? "pipeline-step-source" : undefined}
                className="absolute text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={boxStyle}
                onClick={() => onSelectStep(node.id)}
              >
                {card}
              </button>
            );
          }
          return (
            <div
              key={node.id}
              data-testid="pipeline-node"
              data-id={node.id}
              data-kind={node.kind}
              data-label={node.label}
              data-current={selected ? "true" : undefined}
              className="absolute"
              style={boxStyle}
            >
              {card}
            </div>
          );
        })}
      </div>
    </div>
  );
}
