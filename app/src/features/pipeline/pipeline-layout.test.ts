import { describe, expect, it } from "vitest";
import {
  PHONE_WIDTH,
  cardChromeWidth,
  layoutPipelineDiagram,
  pickNodeLabel,
} from "./pipeline-layout";
import { pipelines } from "./shape";

const planning = pipelines.find((pipeline) => pipeline.id === "planning")!;
const work = pipelines.find((pipeline) => pipeline.id === "work")!;

const measure = (text: string) => text.length * 8;

describe("layoutPipelineDiagram", () => {
  it("makes a one-node layer a full-width row at phone width", () => {
    const layout = layoutPipelineDiagram(planning, PHONE_WIDTH, measure);
    const byId = Object.fromEntries(layout.nodes.map((node) => [node.id, node]));
    const singles = ["grill", "polish", "polish-apply", "work-handoff"];
    const width = byId.grill!.cardW;
    expect(width).toBeGreaterThan(200);
    for (const id of singles) {
      expect(byId[id]!.cardW, id).toBe(width);
      expect(byId[id]!.label, id).toBe(
        planning.nodes.find((node) => node.id === id)!.name,
      );
    }
    const sibling = byId.research!;
    expect(sibling.cardW).toBeLessThan(width);
  });

  it("keeps every fan-out sibling inside the phone lane", () => {
    const layout = layoutPipelineDiagram(planning, PHONE_WIDTH, measure);
    expect(layout.width).toBe(PHONE_WIDTH);
    const checks = layout.nodes.filter((node) => node.id.startsWith("check-"));
    expect(checks).toHaveLength(6);
    for (const node of layout.nodes) {
      expect(node.x - node.cardW / 2).toBeGreaterThanOrEqual(0);
      expect(node.x + node.cardW / 2).toBeLessThanOrEqual(layout.width);
    }
    expect(checks.every((node) => node.dense)).toBe(true);
  });

  it("places fan-out siblings on distinct x with room for their own drop", () => {
    const layout = layoutPipelineDiagram(planning, PHONE_WIDTH, measure);
    const checks = layout.nodes.filter((node) => node.id.startsWith("check-"));
    expect(checks).toHaveLength(6);
    const xs = checks.map((node) => node.x);
    expect(new Set(xs.map((x) => Math.round(x))).size).toBe(6);
    expect(checks.every((node) => node.y === checks[0]!.y)).toBe(true);
  });

  it("keeps desktop cards on a fixed width and full names", () => {
    const layout = layoutPipelineDiagram(planning, 1024, measure);
    expect(layout.compact).toBe(false);
    for (const node of layout.nodes) {
      expect(node.cardW).toBe(168);
      expect(node.label).toBe(node.name);
    }
  });

  it("lays out both declared pipelines at phone width", () => {
    for (const pipeline of [planning, work]) {
      const layout = layoutPipelineDiagram(pipeline, PHONE_WIDTH, measure);
      expect(layout.compact).toBe(true);
      expect(layout.nodes).toHaveLength(pipeline.nodes.length);
      const singles = layout.nodes.filter((node) => {
        const siblings = layout.nodes.filter((other) => other.y === node.y);
        return siblings.length === 1;
      });
      expect(singles.length).toBeGreaterThan(0);
      const fullW = singles[0]!.cardW;
      for (const node of singles) {
        expect(node.cardW).toBe(fullW);
        expect(node.label).toBe(node.name);
      }
    }
  });
});

describe("pickNodeLabel", () => {
  it("measures against available inner width", () => {
    expect(pickNodeLabel({ name: "DRY", shortLabel: "D" }, 30, measure)).toBe(
      "DRY",
    );
    expect(
      pickNodeLabel(
        { name: "Internal consistency", shortLabel: "Consistency" },
        40,
        measure,
      ),
    ).toBe("Consistency");
  });

  it("sizes chrome without a character-width guess", () => {
    expect(cardChromeWidth("step")).toBe(34);
    expect(cardChromeWidth("gate")).toBe(38);
    expect(cardChromeWidth("handoff")).toBe(36);
  });
});
