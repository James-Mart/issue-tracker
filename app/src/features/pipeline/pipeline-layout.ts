import { assignLayers, layoutDepGraph } from "@/components/ui/dependency-graph";
import type { Pipeline, PipelineEdge, PipelineNode, PipelineNodeKind } from "./shape";

export const PHONE_WIDTH = 390;
export const NARROW_MAX_WIDTH = 640;

export const DESKTOP_CARD_W = 168;
export const DESKTOP_CARD_H = 60;
export const DESKTOP_COL_GAP = 152;
export const DESKTOP_ROW_GAP = 84;
export const DESKTOP_PAD_X = 28;
export const DESKTOP_PAD_Y = 28;
export const DESKTOP_LOOP_GUTTER = 80;

const PHONE_CARD_H = 56;
const PHONE_ROW_GAP = 80;
const PHONE_PAD_X = 12;
const PHONE_PAD_Y = 12;
const PHONE_LOOP_GUTTER = 32;
const PHONE_SIBLING_GAP = 4;
const DENSE_ROW_MIN = 4;

const LABEL_FONT =
  '500 12px "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export type PlacedPipelineNode = PipelineNode & {
  x: number;
  y: number;
  cardW: number;
  label: string;
  dense: boolean;
};

export type PipelineDiagramLayout = {
  nodes: PlacedPipelineNode[];
  edges: PipelineEdge[];
  width: number;
  height: number;
  compact: boolean;
  cardH: number;
  padX: number;
  loopGutter: number;
};

export function isCompactWidth(width: number | undefined): boolean {
  return width != null && width > 0 && width <= NARROW_MAX_WIDTH;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

function canvasMeasure(text: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return 0;
  measureCtx.font = LABEL_FONT;
  return measureCtx.measureText(text).width;
}

function domMeasure(text: string): number {
  const span = document.createElement("span");
  span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${LABEL_FONT}`;
  span.textContent = text;
  document.body.appendChild(span);
  const measured = span.getBoundingClientRect().width;
  span.remove();
  return measured;
}

/** Painted text width — not a character-count estimate. */
export function measureLabelWidth(text: string): number {
  const fromCanvas = canvasMeasure(text);
  if (fromCanvas > 0) return fromCanvas;
  return domMeasure(text);
}

export function cardChromeWidth(
  kind: PipelineNodeKind,
  dense = false,
): number {
  if (dense) return 8;
  const padX = 16;
  const gap = 6;
  const icon = kind === "gate" ? 16 : kind === "handoff" ? 14 : 12;
  return padX + gap + icon;
}

export function pickNodeLabel(
  node: Pick<PipelineNode, "name" | "shortLabel">,
  availableInner: number,
  measure: (text: string) => number,
): string {
  if (measure(node.name) <= availableInner) return node.name;
  return node.shortLabel ?? node.name;
}

function isForwardEdge(edge: PipelineEdge): boolean {
  return edge.kind !== "loop";
}

function desktopLayout(pipeline: Pipeline): PipelineDiagramLayout {
  const layout = layoutDepGraph(pipeline, {
    layeringEdges: isForwardEdge,
    colGap: DESKTOP_COL_GAP,
    rowGap: DESKTOP_ROW_GAP,
    labelW: DESKTOP_CARD_W,
    padX: DESKTOP_PAD_X,
    padY: DESKTOP_PAD_Y,
    gutterLeft: DESKTOP_LOOP_GUTTER,
    nodeHeight: DESKTOP_CARD_H,
  });
  return {
    nodes: layout.nodes.map((node) => ({
      ...node,
      cardW: DESKTOP_CARD_W,
      label: node.name,
      dense: false,
    })),
    edges: pipeline.edges,
    width: layout.width,
    height: layout.height,
    compact: false,
    cardH: DESKTOP_CARD_H,
    padX: DESKTOP_PAD_X,
    loopGutter: DESKTOP_LOOP_GUTTER,
  };
}

function compactLayout(
  pipeline: Pipeline,
  containerWidth: number,
  measure: (text: string) => number,
): PipelineDiagramLayout {
  const nodeIds = pipeline.nodes.map((node) => node.id);
  const byId = new Map(pipeline.nodes.map((node) => [node.id, node]));
  const layers = assignLayers(nodeIds, pipeline.edges.filter(isForwardEdge));

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
  const availableCore = Math.max(
    0,
    containerWidth - PHONE_PAD_X * 2 - PHONE_LOOP_GUTTER,
  );

  type RowCard = { id: string; cardW: number; label: string; dense: boolean };
  const rowCards = new Map<number, RowCard[]>();

  for (let row = 0; row <= maxRow; row++) {
    const ids = rows.get(row) ?? [];
    if (ids.length === 0) continue;

    if (ids.length === 1) {
      const node = byId.get(ids[0]!)!;
      rowCards.set(row, [
        { id: node.id, cardW: availableCore, label: node.name, dense: false },
      ]);
      continue;
    }

    const dense = ids.length >= DENSE_ROW_MIN;
    const slot = Math.floor(
      (availableCore - (ids.length - 1) * PHONE_SIBLING_GAP) / ids.length,
    );
    const cards = ids.map((id) => {
      const node = byId.get(id)!;
      const inner = Math.max(0, slot - cardChromeWidth(node.kind, dense));
      return {
        id,
        cardW: slot,
        label: pickNodeLabel(node, inner, measure),
        dense,
      };
    });
    rowCards.set(row, cards);
  }

  const positions = new Map<string, PlacedPipelineNode>();
  const graphLeft = PHONE_PAD_X + PHONE_LOOP_GUTTER;
  const anchorY = PHONE_CARD_H / 2;

  for (let row = 0; row <= maxRow; row++) {
    const cards = rowCards.get(row);
    if (!cards || cards.length === 0) continue;
    const rowWidth =
      cards.reduce((sum, card) => sum + card.cardW, 0) +
      (cards.length - 1) * PHONE_SIBLING_GAP;
    let left = graphLeft + (availableCore - rowWidth) / 2;
    const y = PHONE_PAD_Y + anchorY + row * PHONE_ROW_GAP;
    for (const card of cards) {
      const node = byId.get(card.id)!;
      positions.set(card.id, {
        ...node,
        x: left + card.cardW / 2,
        y,
        cardW: card.cardW,
        label: card.label,
        dense: card.dense,
      });
      left += card.cardW + PHONE_SIBLING_GAP;
    }
  }

  const placed = nodeIds.flatMap((id) => {
    const node = positions.get(id);
    return node ? [node] : [];
  });

  return {
    nodes: placed,
    edges: pipeline.edges,
    width: containerWidth,
    height: PHONE_PAD_Y * 2 + PHONE_CARD_H + Math.max(0, maxRow) * PHONE_ROW_GAP,
    compact: true,
    cardH: PHONE_CARD_H,
    padX: PHONE_PAD_X,
    loopGutter: PHONE_LOOP_GUTTER,
  };
}

export function layoutPipelineDiagram(
  pipeline: Pipeline,
  containerWidth?: number,
  measure: (text: string) => number = measureLabelWidth,
): PipelineDiagramLayout {
  if (isCompactWidth(containerWidth)) {
    return compactLayout(pipeline, containerWidth!, measure);
  }
  return desktopLayout(pipeline);
}
