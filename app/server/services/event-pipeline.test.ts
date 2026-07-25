import { describe, expect, it } from "vitest";
import { extractTaskHints } from "./event-pipeline.js";

describe("extractTaskHints", () => {
  // The SDK's task result is a `{ status, value }` union, so the hints a
  // Cursor Task call carries are one level down from the bridge's own shape.
  it("lifts hints out of the SDK task-result envelope", () => {
    expect(
      extractTaskHints({
        status: "success",
        value: {
          agentId: " bc-nested-1 ",
          transcriptPath: " /tmp/agent-transcripts/bc-nested-1 ",
          isBackground: false,
          backgroundReason: "unspecified",
        },
      }),
    ).toEqual({
      resultAgentId: "bc-nested-1",
      transcriptPath: "/tmp/agent-transcripts/bc-nested-1",
    });
  });

  it("lifts hints off a flat result", () => {
    expect(extractTaskHints({ agentId: "bc-nested-1" })).toEqual({
      resultAgentId: "bc-nested-1",
    });
  });

  it("returns nothing when no hint is present", () => {
    expect(extractTaskHints({ status: "error", error: "boom" })).toEqual({});
    expect(extractTaskHints({ agentId: "  " })).toEqual({});
    expect(extractTaskHints("delegation done")).toEqual({});
    expect(extractTaskHints(null)).toEqual({});
  });
});
