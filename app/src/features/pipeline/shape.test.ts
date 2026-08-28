import { describe, expect, it } from "vitest";
import { pipelines } from "./shape";

const pipelineIds = new Set(pipelines.map((p) => p.id));

describe.each(pipelines.map((p) => [p.id, p] as const))(
  "%s pipeline",
  (_id, pipeline) => {
    it("declares each node id once", () => {
      const ids = pipeline.nodes.map((node) => node.id);
      expect(ids).toEqual([...new Set(ids)]);
    });

    it("declares each node under its own pipeline", () => {
      for (const node of pipeline.nodes) {
        expect(node.pipeline).toBe(pipeline.id);
      }
    });

    it("resolves every edge endpoint to a node in the same pipeline", () => {
      const ids = new Set(pipeline.nodes.map((node) => node.id));
      for (const edge of pipeline.edges) {
        expect(ids, `${edge.kind} edge from ${edge.from}`).toContain(edge.from);
        expect(ids, `${edge.kind} edge to ${edge.to}`).toContain(edge.to);
      }
    });

    it("gives a handoff a declared target pipeline and no source", () => {
      for (const node of pipeline.nodes) {
        if (node.kind !== "handoff") continue;
        expect(pipelineIds, node.id).toContain(node.targetPipeline);
        expect(node, node.id).not.toHaveProperty("source");
      }
    });

    it("gives every step and gate a source", () => {
      for (const node of pipeline.nodes) {
        if (node.kind === "handoff") continue;
        expect(node.source, node.id).toBeTruthy();
      }
    });

    it("never repeats a name as its own short label", () => {
      for (const node of pipeline.nodes) {
        expect(node.shortLabel, node.id).not.toBe(node.name);
      }
    });
  },
);
