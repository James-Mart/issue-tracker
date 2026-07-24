import * as React from "react";
import { Link } from "react-router-dom";
import type { DepGraphEdge, DepGraphModel, DepGraphNode } from "@/features/issues/lib/flow";
import { RailPort } from "@/components/ui/rail";
import { cn } from "@/lib/utils/cn";

const PORT = 12;
const COL_GAP = 120;
const ROW_GAP = 64;
const PAD_X = 24;
const PAD_Y = 16;
const LABEL_H = 20;
const LABEL_W = 112;

type PlacedNode = DepGraphNode & { x: number; y: number };

export type GraphLayout = {
  nodes: PlacedNode[];
  edges: Array<DepGraphEdge & { x1: number; y1: number; x2: number; y2: number }>;
  width: number;
  height: number;
};

function assignLayers(
  nodeIds: string[],
  edges: DepGraphEdge[],
): Map<string, number> {
  const idSet = new Set(nodeIds);
  const preds = new Map<string, string[]>();
  for (const id of nodeIds) preds.set(id, []);
  for (const edge of edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
    preds.get(edge.to)!.push(edge.from);
  }

  const layer = new Map<string, number>();
  const visiting = new Set<string>();

  function depth(id: string): number {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = preds.get(id) ?? [];
    const value =
      parents.length === 0 ? 0 : 1 + Math.max(...parents.map(depth));
    visiting.delete(id);
    layer.set(id, value);
    return value;
  }

  for (const id of nodeIds) depth(id);
  return layer;
}

/** Layered top-down DAG layout: prerequisites above dependents. */
export function layoutDepGraph(model: DepGraphModel): GraphLayout {
  const nodeIds = model.nodes.map((n) => n.id);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const layers = assignLayers(nodeIds, model.edges);

  const rows = new Map<number, string[]>();
  for (const id of nodeIds) {
    const row = layers.get(id) ?? 0;
    const list = rows.get(row) ?? [];
    list.push(id);
    rows.set(row, list);
  }
  for (const list of rows.values()) {
    list.sort((a, b) => a.localeCompare(b));
  }

  const maxRow = Math.max(0, ...rows.keys());
  const maxCols = Math.max(1, ...[...rows.values()].map((r) => r.length));

  const positions = new Map<string, { x: number; y: number }>();
  for (let row = 0; row <= maxRow; row++) {
    const ids = rows.get(row) ?? [];
    const blockWidth = Math.max(0, ids.length - 1) * COL_GAP;
    const startX = PAD_X + LABEL_W / 2 + ((maxCols - 1) * COL_GAP - blockWidth) / 2;
    ids.forEach((id, col) => {
      positions.set(id, {
        x: startX + col * COL_GAP,
        y: PAD_Y + PORT / 2 + row * ROW_GAP,
      });
    });
  }

  const placed: PlacedNode[] = nodeIds.flatMap((id) => {
    const node = byId.get(id);
    const pos = positions.get(id);
    if (!node || !pos) return [];
    return [{ ...node, ...pos }];
  });

  const idSet = new Set(nodeIds);
  const edges = model.edges.flatMap((edge) => {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) return [];
    const a = positions.get(edge.from);
    const b = positions.get(edge.to);
    if (!a || !b) return [];
    return [{ ...edge, x1: a.x, y1: a.y, x2: b.x, y2: b.y }];
  });

  const width = PAD_X * 2 + LABEL_W + Math.max(0, maxCols - 1) * COL_GAP;
  const height =
    PAD_Y * 2 + PORT + LABEL_H + 4 + Math.max(0, maxRow) * ROW_GAP;

  return { nodes: placed, edges, width, height };
}

function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dy = y2 - y1;
  const mid = y1 + dy / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

export interface DependencyGraphProps
  extends React.HTMLAttributes<HTMLDivElement> {
  model: DepGraphModel;
  /** When set, each node label/port links here (e.g. Epic detail). */
  nodeHref?: (node: DepGraphNode) => string;
}

/**
 * DAG node-link graph in Rail vocabulary: state-encoded ports, solid
 * satisfied edges, dashed blocked waiting edges.
 */
export function DependencyGraph({
  model,
  nodeHref,
  className,
  ...props
}: DependencyGraphProps) {
  const layout = React.useMemo(() => layoutDepGraph(model), [model]);

  if (layout.nodes.length === 0) {
    return (
      <div
        role="img"
        aria-label="Dependency graph (empty)"
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label="Dependency graph"
      className={cn("relative overflow-x-auto", className)}
      style={{ width: layout.width, height: layout.height }}
      {...props}
    >
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="absolute inset-0 block"
        aria-hidden="true"
      >
        {layout.edges.map((edge) => (
          <path
            key={`${edge.from}->${edge.to}`}
            d={edgePath(edge.x1, edge.y1, edge.x2, edge.y2)}
            fill="none"
            stroke={
              edge.satisfied
                ? "hsl(var(--rail-lit))"
                : "hsl(var(--blocked))"
            }
            strokeWidth={2}
            strokeDasharray={edge.satisfied ? undefined : "4 4"}
            opacity={edge.satisfied ? 1 : 0.55}
            data-testid="dep-graph-edge"
            data-from={edge.from}
            data-to={edge.to}
            data-satisfied={edge.satisfied ? "true" : "false"}
          />
        ))}
      </svg>
      {layout.nodes.map((node) => (
        <GraphPort
          key={node.id}
          node={node}
          href={nodeHref?.(node)}
        />
      ))}
    </div>
  );
}

function GraphPort({ node, href }: { node: PlacedNode; href?: string }) {
  const port = (
    <RailPort
      state={node.state}
      label={node.label}
      className="flex w-full flex-col items-center"
      labelClassName="mt-1 w-full truncate text-center text-xs"
    />
  );

  return (
    <div
      data-testid="dep-graph-node"
      data-id={node.id}
      data-state={node.state}
      className="absolute"
      style={{
        left: node.x - LABEL_W / 2,
        top: node.y - PORT / 2,
        width: LABEL_W,
      }}
    >
      {href != null ? (
        <Link
          to={href}
          className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {port}
        </Link>
      ) : (
        port
      )}
    </div>
  );
}
