import { describe, expect, it } from "vitest";
import { pipelineRunPath } from "./paths";

describe("pipelineRunPath", () => {
  it("builds the selected-run route", () => {
    expect(pipelineRunPath("conv-1")).toBe("/pipeline/runs/conv-1");
  });

  it("encodes the conversation id", () => {
    expect(pipelineRunPath("conv/a b")).toBe("/pipeline/runs/conv%2Fa%20b");
  });
});
