// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { layoutDepGraph } from "@/components/ui/dependency-graph";
import { PipelineDiagram } from "./pipeline-diagram";
import {
  PHONE_WIDTH,
  layoutPipelineDiagram,
  pickNodeLabel,
} from "./pipeline-layout";
import {
  pipelines,
  type Pipeline,
  type PipelineEdge,
  type PipelineId,
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

function mountDiagram(
  pipeline: Pipeline,
  containerWidth?: number,
  onHandoff?: (targetPipeline: PipelineId) => void,
  onSelectStep?: (stepId: string) => void,
  selectedStepId?: string,
): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PipelineDiagram
        pipeline={pipeline}
        containerWidth={containerWidth}
        selectedStepId={selectedStepId}
        onSelectStep={onSelectStep}
        onHandoff={onHandoff}
      />,
    );
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

  it("activates a handoff toward its declared target pipeline", () => {
    const targets: PipelineId[] = [];
    const { container } = mountDiagram(KINDS_PIPELINE, undefined, (id) => {
      targets.push(id);
    });
    const handoff = nodeEl(container, "work-handoff");
    expect(handoff.tagName).toBe("BUTTON");
    expect(handoff.getAttribute("data-target-pipeline")).toBe("work");
    act(() => {
      handoff.click();
    });
    expect(targets).toEqual(["work"]);
  });

  it("selects a step or gate and leaves a handoff to navigate", () => {
    const selected: string[] = [];
    const targets: PipelineId[] = [];
    const { container } = mountDiagram(
      KINDS_PIPELINE,
      undefined,
      (id) => {
        targets.push(id);
      },
      (stepId) => {
        selected.push(stepId);
      },
    );

    const step = nodeEl(container, "research");
    const gate = nodeEl(container, "outline-gate");
    expect(step.tagName).toBe("BUTTON");
    expect(gate.tagName).toBe("BUTTON");
    act(() => {
      step.click();
      gate.click();
      nodeEl(container, "work-handoff").click();
    });
    expect(selected).toEqual(["research", "outline-gate"]);
    expect(targets).toEqual(["work"]);
  });

  it("marks the selected step with the current treatment", () => {
    const { container } = mountDiagram(
      KINDS_PIPELINE,
      undefined,
      undefined,
      () => {},
      "research",
    );
    const step = nodeEl(container, "research");
    expect(step.getAttribute("data-current")).toBe("true");
    expect(step.getAttribute("aria-pressed")).toBe("true");
    expect(step.innerHTML).toContain("hsl(var(--current))");
    expect(nodeEl(container, "outline-gate").getAttribute("data-current")).toBeNull();
    expect(nodeEl(container, "work-handoff").innerHTML).not.toContain(
      "hsl(var(--current))",
    );
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

function pathEndX(d: string): number {
  const nums = [...d.matchAll(/-?[\d.]+/g)].map(Number);
  return nums[nums.length - 2]!;
}

function nodeCenterX(el: HTMLElement): number {
  return parseFloat(el.style.left) + parseFloat(el.style.width) / 2;
}

const planning = pipelines.find((pipeline) => pipeline.id === "planning")!;
const work = pipelines.find((pipeline) => pipeline.id === "work")!;

const POLISH_FANOUT = [
  "check-authoring-conformance",
  "check-dependency-order",
  "check-dry",
  "check-footprint",
  "check-internal-consistency",
  "check-no-ambiguity",
] as const;

describe("PipelineDiagram phone width", () => {
  it("gives each fan-out sibling its own incoming edge", () => {
    const { container } = mountDiagram(planning, PHONE_WIDTH);
    const edges = edgeEls(container);
    const endXs: number[] = [];

    for (const id of POLISH_FANOUT) {
      const node = nodeEl(container, id);
      const edge = edges.find(
        (el) =>
          el.getAttribute("data-from") === "polish" &&
          el.getAttribute("data-to") === id,
      );
      if (!edge) throw new Error(`Missing fan-out edge to ${id}`);
      expect(edge.getAttribute("marker-end")).toBeTruthy();
      const d = edge.getAttribute("d") ?? "";
      expect(d).toMatch(/ L /);
      const endX = pathEndX(d);
      expect(endX).toBeCloseTo(nodeCenterX(node), 5);
      endXs.push(endX);
    }

    expect(new Set(endXs.map((x) => Math.round(x))).size).toBe(
      POLISH_FANOUT.length,
    );

    const inner = container.querySelector(
      '[data-testid="pipeline-diagram"] > div',
    );
    if (!(inner instanceof HTMLElement)) {
      throw new Error("Missing diagram inner");
    }
    const lane = parseFloat(inner.style.width);
    for (const id of POLISH_FANOUT) {
      const node = nodeEl(container, id);
      const right = parseFloat(node.style.left) + parseFloat(node.style.width);
      expect(right).toBeLessThanOrEqual(lane);
      expect(parseFloat(node.style.left)).toBeGreaterThanOrEqual(0);
    }
  });

  it("renders a name in full when it fits and never truncates it", () => {
    const { container } = mountDiagram(planning, PHONE_WIDTH);
    const grill = nodeEl(container, "grill");
    expect(grill.getAttribute("data-label")).toBe("Grill-me protocol");
    expect(grill.textContent).toContain("Grill-me protocol");
    expect(grill.querySelector(".truncate")).toBeNull();

    const apply = nodeEl(container, "polish-apply");
    expect(apply.getAttribute("data-label")).toBe(
      "Aggregate → apply → summary",
    );
    expect(apply.textContent).toContain("Aggregate → apply → summary");
    expect(apply.querySelector(".truncate")).toBeNull();

    const dry = nodeEl(container, "check-dry");
    expect(dry.getAttribute("data-label")).toBe("DRY");
    expect(dry.textContent).toContain("DRY");
  });

  it("uses shortLabel only when the real name does not fit", () => {
    const measure = (text: string) => {
      if (text === "Focused codebase research") return 400;
      if (text === "Research") return 40;
      if (text === "Mockup round") return 40;
      return text.length * 6;
    };
    const layout = layoutPipelineDiagram(planning, PHONE_WIDTH, measure);
    const byId = Object.fromEntries(layout.nodes.map((node) => [node.id, node]));

    expect(byId.research!.label).toBe("Research");
    expect(byId["mockup-round"]!.label).toBe("Mockup round");
    expect(byId.grill!.label).toBe("Grill-me protocol");

    const { container } = mountDiagram(planning, PHONE_WIDTH);
    expect(nodeEl(container, "grill").textContent).toContain(
      "Grill-me protocol",
    );
    expect(container.querySelector(".truncate")).toBeNull();
  });

  it.each([
    ["planning", planning],
    ["work", work],
  ] as const)("does not clip cards on the %s pipeline", (_id, pipeline) => {
    const { container } = mountDiagram(pipeline, PHONE_WIDTH);
    const diagram = container.querySelector('[data-testid="pipeline-diagram"]');
    expect(diagram?.getAttribute("data-layout")).toBe("phone");
    const inner = container.querySelector(
      '[data-testid="pipeline-diagram"] > div',
    );
    if (!(inner instanceof HTMLElement)) {
      throw new Error("Missing diagram inner");
    }
    const layoutWidth = parseFloat(inner.style.width);
    expect(layoutWidth).toBeLessThanOrEqual(PHONE_WIDTH);
    for (const node of pipeline.nodes) {
      const el = nodeEl(container, node.id);
      expect(el.className).not.toMatch(/\boverflow-hidden\b/);
      expect(el.querySelector(".truncate")).toBeNull();
      expect(parseFloat(el.style.width)).toBeGreaterThan(0);
      const right = parseFloat(el.style.left) + parseFloat(el.style.width);
      expect(right).toBeLessThanOrEqual(layoutWidth);
    }
  });
});

describe("pickNodeLabel", () => {
  it("keeps a name that fits and falls back only when it does not", () => {
    const measure = (text: string) => text.length * 10;
    expect(
      pickNodeLabel(
        { name: "DRY", shortLabel: "D" },
        40,
        measure,
      ),
    ).toBe("DRY");
    expect(
      pickNodeLabel(
        { name: "Internal consistency", shortLabel: "Consistency" },
        40,
        measure,
      ),
    ).toBe("Consistency");
    expect(pickNodeLabel({ name: "Footprint" }, 20, measure)).toBe("Footprint");
  });
});
