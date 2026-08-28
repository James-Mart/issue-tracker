import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIPELINE_ID,
  parsePipelineId,
  pipelineById,
  writePipelineParam,
} from "./pipeline-selection";
import { pipelines } from "./shape";

describe("parsePipelineId", () => {
  it("defaults absent and unknown values to planning", () => {
    expect(parsePipelineId(null)).toBe(DEFAULT_PIPELINE_ID);
    expect(parsePipelineId("")).toBe("planning");
    expect(parsePipelineId("other")).toBe("planning");
  });

  it("accepts every declared pipeline id", () => {
    for (const pipeline of pipelines) {
      expect(parsePipelineId(pipeline.id)).toBe(pipeline.id);
    }
  });
});

describe("writePipelineParam", () => {
  it("omits the param for the default planning pipeline", () => {
    const params = new URLSearchParams("pipeline=work&x=1");
    expect(writePipelineParam(params, "planning").toString()).toBe("x=1");
  });

  it("sets pipeline for a non-default selection", () => {
    const params = new URLSearchParams("x=1");
    expect(writePipelineParam(params, "work").toString()).toBe(
      "x=1&pipeline=work",
    );
  });
});

describe("pipelineById", () => {
  it("returns each declared pipeline", () => {
    for (const pipeline of pipelines) {
      expect(pipelineById(pipeline.id)).toBe(pipeline);
    }
  });
});
