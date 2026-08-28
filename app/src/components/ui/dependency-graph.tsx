import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils/cn";

const PORT = 12;
const COL_GAP = 120;
const ROW_GAP = 64;
const PAD_X = 24;
const PAD_Y = 16;
const LABEL_H = 20;
const LABEL_W = 112;

/** Minimum node payload the layered layout requires. */
export type GraphNode = { id: string };

/** Minimum edge payload the layered layout requires. */
export type GraphEdge = { from: string; to: string };

export type GraphModel<N extends GraphNode, E extends GraphEdge> = {
  nodes: N[];
  edges: E[];
};

export type PlacedNode<N extends GraphNode> = N & { x: number; y: number };

export type GraphLayout<N extends GraphNode, E extends GraphEdge> = {
  nodes: PlacedNode<N>[];
  edges: Array<E & { x1: number; y1: number; x2: number; y2: number }>;
  width: number;
  height: number;
};

/** Optional metrics and layering filter. Omitted fields keep the rail defaults. */
export type GraphLayoutOptions<E extends GraphEdge = GraphEdge> = {
  /** Edges that assign layers. Default: every edge. Back-edges should be omitted. */
  layeringEdges?: (edge: E) => boolean;
  colGap?: number;
  rowGap?: number;
  labelW?: number;
  labelH?: number;
  padX?: number;
  padY?: number;
  /** Extra left inset reserved for side arcs (loop gutters). */
  gutterLeft?: number;
  /** Card/node box height. When set, `y` is the vertical center of that box. */
  nodeHeight?: number;
};

/** Caller-owned stroke treatment for one edge path. */
export type GraphEdgeStroke = {
  stroke: string;
  strokeDasharray?: string;
  opacity?: number;
};

function assignLayers(
  nodeIds: string[],
  edges: GraphEdge[],
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
export function layoutDepGraph<N extends GraphNode, E extends GraphEdge>(
  model: GraphModel<N, E>,
  options?: GraphLayoutOptions<E>,
): GraphLayout<N, E> {
  const colGap = options?.colGap ?? COL_GAP;
  const rowGap = options?.rowGap ?? ROW_GAP;
  const labelW = options?.labelW ?? LABEL_W;
  const labelH = options?.labelH ?? LABEL_H;
  const padX = options?.padX ?? PAD_X;
  const padY = options?.padY ?? PAD_Y;
  const gutterLeft = options?.gutterLeft ?? 0;
  const nodeHeight = options?.nodeHeight ?? PORT + labelH + 4;
  const anchorY =
    options?.nodeHeight != null ? options.nodeHeight / 2 : PORT / 2;

  const nodeIds = model.nodes.map((n) => n.id);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const layering = options?.layeringEdges
    ? model.edges.filter(options.layeringEdges)
    : model.edges;
  const layers = assignLayers(nodeIds, layering);

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
    const blockWidth = Math.max(0, ids.length - 1) * colGap;
    const startX =
      padX + gutterLeft + labelW / 2 + ((maxCols - 1) * colGap - blockWidth) / 2;
    ids.forEach((id, col) => {
      positions.set(id, {
        x: startX + col * colGap,
        y: padY + anchorY + row * rowGap,
      });
    });
  }

  const placed: PlacedNode<N>[] = nodeIds.flatMap((id) => {
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

  const width = padX * 2 + gutterLeft + labelW + Math.max(0, maxCols - 1) * colGap;
  const height = padY * 2 + nodeHeight + Math.max(0, maxRow) * rowGap;

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

export interface DependencyGraphProps<
  N extends GraphNode,
  E extends GraphEdge,
> extends React.HTMLAttributes<HTMLDivElement> {
  model: GraphModel<N, E>;
  /** Node body; the graph owns placement, not appearance. */
  renderNode: (node: PlacedNode<N>) => React.ReactNode;
  /** Stroke, dash, and opacity for one edge — never inferred from the payload. */
  edgeStroke: (edge: E) => GraphEdgeStroke;
  /** When set, each node links here (e.g. Epic detail). */
  nodeHref?: (node: N) => string;
}

/**
 * Layered node-link graph. Callers supply node appearance and edge stroke;
 * every edge path carries an arrowhead marker.
 */
export function DependencyGraph<N extends GraphNode, E extends GraphEdge>({
  model,
  renderNode,
  edgeStroke,
  nodeHref,
  className,
  ...props
}: DependencyGraphProps<N, E>) {
  const layout = React.useMemo(() => layoutDepGraph(model), [model]);
  const markerId = `dep-graph-arrow-${React.useId().replace(/:/g, "")}`;

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
          const stroke = edgeStroke(edge);
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={edgePath(edge.x1, edge.y1, edge.x2, edge.y2)}
              fill="none"
              stroke={stroke.stroke}
              strokeWidth={2}
              strokeDasharray={stroke.strokeDasharray}
              opacity={stroke.opacity}
              markerEnd={`url(#${markerId})`}
              data-testid="dep-graph-edge"
              data-from={edge.from}
              data-to={edge.to}
            />
          );
        })}
      </svg>
      {layout.nodes.map((node) => (
        <GraphNodeSlot
          key={node.id}
          node={node}
          href={nodeHref?.(node)}
        >
          {renderNode(node)}
        </GraphNodeSlot>
      ))}
    </div>
  );
}

function GraphNodeSlot<N extends GraphNode>({
  node,
  href,
  children,
}: {
  node: PlacedNode<N>;
  href?: string;
  children: React.ReactNode;
}) {
  const body = href != null ? (
    <Link
      to={href}
      className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  ) : (
    children
  );

  return (
    <div
      data-testid="dep-graph-node"
      data-id={node.id}
      className="absolute"
      style={{
        left: node.x - LABEL_W / 2,
        top: node.y - PORT / 2,
        width: LABEL_W,
      }}
    >
      {body}
    </div>
  );
}
