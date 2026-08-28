import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIPELINE_ID,
  parsePipelineId,
  parseStepId,
  pipelineById,
  writePipelineParam,
  writeStepParam,
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

const planning = pipelines.find((pipeline) => pipeline.id === "planning")!;

describe("parseStepId", () => {
  it("accepts a step or gate on the current pipeline", () => {
    expect(parseStepId("grill", planning)).toBe("grill");
    expect(parseStepId("outline-gate", planning)).toBe("outline-gate");
  });

  it("rejects absent, unknown, and handoff ids", () => {
    expect(parseStepId(null, planning)).toBeUndefined();
    expect(parseStepId("implement", planning)).toBeUndefined();
    expect(parseStepId("work-handoff", planning)).toBeUndefined();
  });
});

describe("writeStepParam", () => {
  it("sets and clears the step param", () => {
    const params = new URLSearchParams("pipeline=work");
    expect(writeStepParam(params, "implement").toString()).toBe(
      "pipeline=work&step=implement",
    );
    expect(writeStepParam(params, undefined).toString()).toBe("pipeline=work");
  });
});
