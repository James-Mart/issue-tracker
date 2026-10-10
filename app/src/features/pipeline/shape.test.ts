import { describe, expect, it } from "vitest";
import { pipelines } from "./shape";

describe.each(pipelines.map((p) => [p.id, p] as const))(
  "%s pipeline",
  (_id, pipeline) => {
    it("resolves every edge endpoint to a node in the same pipeline", () => {
      const ids = new Set(pipeline.nodes.map((node) => node.id));
      for (const edge of pipeline.edges) {
        expect(ids, `${edge.kind} edge from ${edge.from}`).toContain(edge.from);
        expect(ids, `${edge.kind} edge to ${edge.to}`).toContain(edge.to);
      }
    });
  },
);
