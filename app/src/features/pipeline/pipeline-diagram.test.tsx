// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { layoutDepGraph } from "@/components/ui/dependency-graph";
import { PipelineDiagram } from "./pipeline-diagram";
import {
  pipelines,
  type Pipeline,
  type PipelineEdge,
  type PipelineNode,
} from "./shape";

const KINDS_PIPELINE: Pipeline = {
  id: "planning",
  title: "Kinds fixture",
  nodes: [
    {
      id: "research",
      name: "Research",
      kind: "step",
      pipeline: "planning",
      source: "agents/issue-tracker-research.md",
    },
    {
      id: "outline-gate",
      name: "Outline gate",
      kind: "gate",
      pipeline: "planning",
      source: "skills/issue-tracker-plan/SKILL.md",
    },
    {
      id: "work-handoff",
      name: "Work the stack",
      kind: "handoff",
      pipeline: "planning",
      targetPipeline: "work",
    },
  ],
  edges: [
    { from: "research", to: "outline-gate", kind: "flow" },
    { from: "outline-gate", to: "work-handoff", kind: "flow" },
    { from: "work-handoff", to: "research", kind: "loop" },
  ],
};

function mountDiagram(pipeline: Pipeline): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PipelineDiagram pipeline={pipeline} />);
  });
  return { container, root };
}

function nodeEl(container: ParentNode, id: string): HTMLElement {
  const el = container.querySelector(`[data-testid="pipeline-node"][data-id="${id}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`Missing node: ${id}`);
  }
  return el;
}

function edgeEls(container: ParentNode): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="pipeline-edge"]'),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PipelineDiagram", () => {
  it("gives each kind its own silhouette", () => {
    const { container } = mountDiagram(KINDS_PIPELINE);

    const step = nodeEl(container, "research");
    expect(step.getAttribute("data-kind")).toBe("step");
    expect(step.querySelector('[data-testid="pipeline-step-port"]')).not.toBeNull();
    expect(step.querySelector('[data-testid="pipeline-gate-glyph"]')).toBeNull();
    expect(step.className + step.innerHTML).not.toContain("border-dashed");
    expect(step.querySelector(".rounded-md")).not.toBeNull();

    const gate = nodeEl(container, "outline-gate");
    expect(gate.getAttribute("data-kind")).toBe("gate");
    expect(gate.querySelector('[data-testid="pipeline-gate-glyph"]')).not.toBeNull();
    expect(gate.querySelector('[data-testid="pipeline-step-port"]')).toBeNull();
    expect(gate.querySelector(".border-double")).not.toBeNull();
    expect(gate.querySelector(".rounded-none")).not.toBeNull();
    expect(gate.querySelector(".rounded-md")).toBeNull();

    const handoff = nodeEl(container, "work-handoff");
    expect(handoff.getAttribute("data-kind")).toBe("handoff");
    expect(
      handoff.querySelector('[data-testid="pipeline-handoff-glyph"]'),
    ).not.toBeNull();
    expect(handoff.querySelector(".border-dashed")).not.toBeNull();
    expect(handoff.textContent).toContain("Work the stack");
    expect(
      [...handoff.querySelectorAll("span")].some(
        (span) =>
          span.className.includes("text-muted-foreground") &&
          span.textContent?.includes("Work the stack"),
      ),
    ).toBe(true);

    expect(container.innerHTML).not.toContain("hsl(var(--current))");
    expect(container.innerHTML).not.toContain("hsl(var(--warn))");
  });

  it("draws a loop as a dashed arc without changing layers", () => {
    const { container } = mountDiagram(KINDS_PIPELINE);
    const loop = edgeEls(container).find(
      (el) => el.getAttribute("data-kind") === "loop",
    );
    if (!loop) throw new Error("Missing loop edge");

    expect(loop.getAttribute("stroke-dasharray")).toBe("4 3");
    const d = loop.getAttribute("d") ?? "";
    expect(d).toMatch(/^M .+ C /);
    const arc = /^M ([\d.]+) ([\d.]+) C ([\d.]+)/.exec(d);
    if (!arc) throw new Error(`Unexpected loop path: ${d}`);
    expect(Number(arc[3])).toBeLessThan(Number(arc[1]));

    const forwardEdges: PipelineEdge[] = KINDS_PIPELINE.edges.filter(
      (edge) => edge.kind !== "loop",
    );
    const withLoop = layoutDepGraph(KINDS_PIPELINE, {
      layeringEdges: (edge: PipelineEdge) => edge.kind !== "loop",
    });
    const forwardOnly = layoutDepGraph({
      nodes: KINDS_PIPELINE.nodes,
      edges: forwardEdges,
    });
    const loopY = Object.fromEntries(withLoop.nodes.map((n) => [n.id, n.y]));
    const forwardY = Object.fromEntries(forwardOnly.nodes.map((n) => [n.id, n.y]));
    expect(loopY).toEqual(forwardY);
    expect(loopY.research).toBeLessThan(loopY["outline-gate"]!);
    expect(loopY["outline-gate"]).toBeLessThan(loopY["work-handoff"]!);
  });

  it.each(pipelines.map((pipeline) => [pipeline.id, pipeline] as const))(
    "renders every node and edge %s declares",
    (_id, pipeline) => {
      const { container } = mountDiagram(pipeline);

      for (const node of pipeline.nodes) {
        const el = nodeEl(container, node.id);
        expect(el.getAttribute("data-kind")).toBe(node.kind);
        expect(el.textContent).toContain(node.name);
      }

      const edges = edgeEls(container);
      expect(edges).toHaveLength(pipeline.edges.length);
      for (const edge of pipeline.edges) {
        const match = edges.find(
          (el) =>
            el.getAttribute("data-from") === edge.from &&
            el.getAttribute("data-to") === edge.to &&
            el.getAttribute("data-kind") === edge.kind,
        );
        expect(match, `${edge.kind} ${edge.from}->${edge.to}`).toBeTruthy();
      }

      const kinds = new Set(
        pipeline.nodes.map((node: PipelineNode) => node.kind),
      );
      expect(kinds.has("step")).toBe(true);
      expect(kinds.has("gate")).toBe(true);
      expect(kinds.has("handoff")).toBe(true);
    },
  );
});
