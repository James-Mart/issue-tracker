import { ExternalLink, UserRound } from "lucide-react";
import { layoutDepGraph } from "@/components/ui/dependency-graph";
import { cn } from "@/lib/utils/cn";
import type { Pipeline, PipelineEdge, PipelineNode } from "./shape";

const CARD_W = 168;
const CARD_H = 60;
const COL_GAP = 152;
const ROW_GAP = 84;
const PAD_X = 28;
const PAD_Y = 28;
const LOOP_GUTTER = 80;
const ARROW_LEN = 6;

function isForwardEdge(edge: PipelineEdge): boolean {
  return edge.kind !== "loop";
}

function forwardEdgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const yStart = from.y + CARD_H / 2;
  const yEnd = to.y - CARD_H / 2 - ARROW_LEN;
  if (Math.abs(to.x - from.x) <= 6) {
    return `M ${from.x} ${yStart} L ${from.x} ${yEnd}`;
  }
  const busY = yStart + (yEnd - yStart) * 0.38;
  return `M ${from.x} ${yStart} L ${from.x} ${busY} L ${to.x} ${busY} L ${to.x} ${yEnd}`;
}

function loopArcPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  gutterX: number,
): string {
  const startX = from.x - CARD_W / 2;
  const startY = from.y + CARD_H / 2;
  const tipY = to.y - CARD_H / 2;
  const endY = tipY - 2;
  // First control holds y so the run reaches the gutter before climbing;
  // the vertical segment stays beside the layers, not through them.
  return `M ${startX} ${startY} C ${gutterX} ${startY}, ${gutterX} ${endY}, ${to.x} ${endY}`;
}

function HollowPort() {
  return (
    <span
      aria-hidden
      data-testid="pipeline-step-port"
      className="h-3 w-3 shrink-0 rounded-full border-2 border-[hsl(var(--ink))] bg-[hsl(var(--void))]"
    />
  );
}

function PipelineNodeCard({ node }: { node: PipelineNode }) {
  if (node.kind === "gate") {
    // Attention hue waits for a published waiting-on-person state.
    return (
      <div className="flex h-full w-full items-center gap-2 rounded-none border-[3px] border-double border-foreground bg-card px-3 py-2">
        <UserRound
          aria-hidden
          data-testid="pipeline-gate-glyph"
          className="h-4 w-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 text-xs font-medium leading-snug text-foreground">
          {node.name}
        </span>
      </div>
    );
  }

  if (node.kind === "handoff") {
    return (
      <div className="flex h-full w-full items-center gap-2 rounded-md border border-dashed border-[hsl(var(--rail-lit))] bg-[hsl(var(--panel))] px-3 py-2">
        <ExternalLink
          aria-hidden
          data-testid="pipeline-handoff-glyph"
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 text-xs font-medium leading-snug text-muted-foreground">
          {node.name}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      <HollowPort />
      <span className="min-w-0 text-xs font-medium leading-snug text-foreground">
        {node.name}
      </span>
    </div>
  );
}

/** One declared pipeline, layered by the generalized graph layout. */
export function PipelineDiagram({
  pipeline,
  className,
}: {
  pipeline: Pipeline;
  className?: string;
}) {
  const layout = layoutDepGraph(pipeline, {
    layeringEdges: isForwardEdge,
    colGap: COL_GAP,
    rowGap: ROW_GAP,
    labelW: CARD_W,
    padX: PAD_X,
    padY: PAD_Y,
    gutterLeft: LOOP_GUTTER,
    nodeHeight: CARD_H,
  });
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const loopEdges = layout.edges.filter((edge) => edge.kind === "loop");
  const markerId = `pipeline-arrow-${pipeline.id}`;

  return (
    <div
      role="img"
      aria-label={`${pipeline.title} diagram`}
      data-testid="pipeline-diagram"
      data-pipeline={pipeline.id}
      className={cn(
        "relative overflow-x-auto rounded-md border border-border bg-[hsl(var(--panel)/0.35)]",
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
          {layout.edges.map((edge) => {
            const from = byId.get(edge.from)!;
            const to = byId.get(edge.to)!;
            const isLoop = edge.kind === "loop";
            const loopIndex = isLoop
              ? loopEdges.findIndex(
                  (candidate) =>
                    candidate.from === edge.from && candidate.to === edge.to,
                )
              : 0;
            const gutterX = PAD_X + LOOP_GUTTER * 0.42 - loopIndex * 14;
            const d = isLoop
              ? loopArcPath(from, to, gutterX)
              : forwardEdgePath(from, to);
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
        {layout.nodes.map((node) => (
          <div
            key={node.id}
            data-testid="pipeline-node"
            data-id={node.id}
            data-kind={node.kind}
            className="absolute"
            style={{
              left: node.x - CARD_W / 2,
              top: node.y - CARD_H / 2,
              width: CARD_W,
              height: CARD_H,
            }}
          >
            <PipelineNodeCard node={node} />
          </div>
        ))}
      </div>
    </div>
  );
}
