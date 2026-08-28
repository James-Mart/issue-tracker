import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import {
  DependencyGraph,
  layoutDepGraph,
  type DependencyGraphProps,
} from "./dependency-graph";
import { RailPort } from "@/components/ui/rail";
import type { DepGraphEdge, DepGraphModel, DepGraphNode } from "@/features/issues/lib/flow";

/** Diamond: C → A, C → B, A → D, B → D */
const diamondModel: DepGraphModel = {
  nodes: [
    { id: "C", label: "C", state: "merged" },
    { id: "A", label: "A", state: "in-flight" },
    { id: "B", label: "B", state: "blocked" },
    { id: "D", label: "D", state: "blocked" },
  ],
  edges: [
    { from: "C", to: "A", satisfied: true },
    { from: "C", to: "B", satisfied: true },
    { from: "A", to: "D", satisfied: false },
    { from: "B", to: "D", satisfied: false },
  ],
};

function renderRailPort(node: DepGraphNode) {
  return React.createElement(RailPort, {
    state: node.state,
    label: node.label,
    className: "flex w-full flex-col items-center",
    labelClassName: "mt-1 w-full truncate text-center text-xs",
  });
}

function satisfiedStroke(edge: DepGraphEdge) {
  return edge.satisfied
    ? { stroke: "hsl(var(--rail-lit))" }
    : {
        stroke: "hsl(var(--blocked))",
        strokeDasharray: "4 4",
        opacity: 0.55,
      };
}

function epicGraphProps(
  extras: Partial<
    Pick<DependencyGraphProps<DepGraphNode, DepGraphEdge>, "nodeHref">
  > = {},
): DependencyGraphProps<DepGraphNode, DepGraphEdge> {
  return {
    model: diamondModel,
    renderNode: renderRailPort,
    edgeStroke: satisfiedStroke,
    ...extras,
  };
}

describe("layoutDepGraph", () => {
  it("layers the diamond prerequisites above dependents", () => {
    const layout = layoutDepGraph(diamondModel);
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]));

    expect(byId.C!.y).toBeLessThan(byId.A!.y);
    expect(byId.C!.y).toBeLessThan(byId.B!.y);
    expect(byId.A!.y).toBe(byId.B!.y);
    expect(byId.A!.y).toBeLessThan(byId.D!.y);
    expect(byId.A!.x).not.toBe(byId.B!.x);

    expect(layout.edges).toHaveLength(4);
    for (const edge of layout.edges) {
      expect(edge.y1).toBeLessThan(edge.y2);
    }
  });

  it("excludes declared back-edges from layer assignment", () => {
    type LoopEdge = { from: string; to: string; kind: "flow" | "loop" };
    const nodes = [{ id: "start" }, { id: "end" }];
    const flow = { from: "start", to: "end", kind: "flow" as const };
    const model = {
      nodes,
      edges: [flow, { from: "end", to: "start", kind: "loop" as const }],
    } satisfies { nodes: { id: string }[]; edges: LoopEdge[] };

    const forwardOnly = layoutDepGraph({ nodes, edges: [flow] });
    const excluded = layoutDepGraph(model, {
      layeringEdges: (edge) => edge.kind !== "loop",
    });

    const forwardY = Object.fromEntries(forwardOnly.nodes.map((n) => [n.id, n.y]));
    const excludedY = Object.fromEntries(excluded.nodes.map((n) => [n.id, n.y]));

    expect(excludedY).toEqual(forwardY);
    expect(excludedY.start).toBeLessThan(excludedY.end!);
    expect(excluded.edges).toHaveLength(2);
  });

  it("reserves a left gutter without changing layer y", () => {
    const model = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ from: "a", to: "b" }],
    };
    const plain = layoutDepGraph(model);
    const guttered = layoutDepGraph(model, { gutterLeft: 40 });

    expect(guttered.nodes.map((n) => n.y)).toEqual(plain.nodes.map((n) => n.y));
    expect(guttered.nodes[0]!.x).toBe(plain.nodes[0]!.x + 40);
    expect(guttered.width).toBe(plain.width + 40);
  });
});

describe("DependencyGraph", () => {
  function renderInTheme(theme: "dark" | "light"): string {
    return renderToStaticMarkup(
      React.createElement(
        "div",
        { "data-theme": theme },
        React.createElement(DependencyGraph, epicGraphProps()),
      ),
    );
  }

  it("mounts nodes and distinguishes satisfied vs dashed edges", () => {
    const html = renderInTheme("dark");

    expect((html.match(/data-testid="dep-graph-node"/g) ?? []).length).toBe(4);
    expect((html.match(/data-testid="dep-graph-edge"/g) ?? []).length).toBe(4);
    expect(html).toContain('data-state="in-flight"');
    expect(html).toContain('data-state="merged"');
    expect(html).toContain('data-state="blocked"');

    const edgeTags = html.match(/<path\b[^>]*>/g) ?? [];
    const edgePaths = edgeTags.filter((t) =>
      t.includes('data-testid="dep-graph-edge"'),
    );
    const satisfied = edgePaths.filter((t) => !t.includes("stroke-dasharray"));
    const waiting = edgePaths.filter((t) => t.includes("stroke-dasharray"));
    expect(satisfied).toHaveLength(2);
    expect(waiting).toHaveLength(2);
    for (const tag of satisfied) {
      expect(tag).toContain('stroke="hsl(var(--rail-lit))"');
      expect(tag).not.toContain("stroke-dasharray");
      expect(tag).toContain("marker-end");
    }
    for (const tag of waiting) {
      expect(tag).toContain('stroke="hsl(var(--blocked))"');
      expect(tag).toContain('stroke-dasharray="4 4"');
      expect(tag).toContain("marker-end");
    }
    expect(html).toContain("<marker");
    expect(html).toContain('fill="context-stroke"');
  });

  it("renders with theme tokens under both dark and light", () => {
    for (const theme of ["dark", "light"] as const) {
      const html = renderInTheme(theme);
      expect(html).toContain('data-theme="' + theme + '"');
      expect(html).toContain("hsl(var(--rail-lit))");
      expect(html).toContain("hsl(var(--blocked))");
      expect(html).toContain("hsl(var(--current))");
      expect(html).toContain("hsl(var(--merged))");
      expect(html).toContain("hsl(var(--void))");
    }
  });

  it("wraps nodes in links when nodeHref is set", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: React.createElement(
            DependencyGraph,
            epicGraphProps({
              nodeHref: (node) => `/epics/${node.id}`,
            }),
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    const html = renderToStaticMarkup(
      React.createElement(RouterProvider, { router }),
    );
    expect(html).toContain('href="/epics/C"');
    expect(html).toContain('href="/epics/D"');
  });

  it("lays out and renders a graph of a foreign node type", () => {
    type StepNode = { id: string; title: string; kind: "step" | "gate" };
    type StepEdge = { from: string; to: string; via: "forward" | "handoff" };

    const model = {
      nodes: [
        { id: "start", title: "Start", kind: "step" as const },
        { id: "review", title: "Review", kind: "gate" as const },
      ],
      edges: [
        { from: "start", to: "review", via: "handoff" as const },
      ],
    } satisfies { nodes: StepNode[]; edges: StepEdge[] };

    const layout = layoutDepGraph(model);
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]));
    expect(byId.start!.title).toBe("Start");
    expect(byId.start!.kind).toBe("step");
    expect(byId.review!.title).toBe("Review");
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]!.via).toBe("handoff");
    expect(byId.start!.y).toBeLessThan(byId.review!.y);

    const html = renderToStaticMarkup(
      React.createElement(DependencyGraph, {
        model,
        renderNode: (node) =>
          React.createElement("span", { "data-kind": node.kind }, node.title),
        edgeStroke: (edge) => ({
          stroke: "hsl(var(--ink))",
          strokeDasharray: edge.via === "handoff" ? "2 3" : undefined,
        }),
      }),
    );

    expect(html).toContain("Start");
    expect(html).toContain("Review");
    expect(html).toContain('data-kind="step"');
    expect(html).toContain('data-kind="gate"');
    expect(html).toContain('stroke-dasharray="2 3"');
    expect(html).toContain("marker-end");
    expect(html).not.toContain("data-state");
    expect(html).not.toContain("rail-port");
  });
});
