import { describe, expect, it } from "vitest";
import type { Issue } from "../schemas.js";
import {
  formatRuntimeLine,
  validateRuntime,
  validateRuntimePatch,
} from "./runtime.js";

function project(overrides: Partial<Extract<Issue, { kind: "project" }>> = {}) {
  return {
    id: "p",
    kind: "project" as const,
    title: "P",
    trunk: "main",
    mergePolicy: "manual" as const,
    maxImplementingRuns: 1,
    order: 0,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("runtime validation", () => {
  it("accepts set phases", () => {
    expect(() =>
      validateRuntime({ build: "npm run build", start: "npm start" }),
    ).not.toThrow();
  });

  it("refuses an empty string phase", () => {
    expect(() => validateRuntime({ build: "" })).toThrow(/cannot be empty/);
  });

  it("refuses runtime patch on non-project", () => {
    expect(() =>
      validateRuntimePatch(
        {
          id: "e",
          kind: "epic",
          title: "E",
          partOf: "p",
          blockedBy: [],
          needsAttention: false,
          attentionReason: null,
          archived: false,
          order: 0,
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
        { runtime: { build: "npm run build" } },
      ),
    ).toThrow(/only valid on a project/);
  });

  it("allows clearing runtime on a project", () => {
    expect(() =>
      validateRuntimePatch(project(), { runtime: null }),
    ).not.toThrow();
  });
});

describe("formatRuntimeLine", () => {
  it("lists set phase names only", () => {
    expect(
      formatRuntimeLine({
        build: "npm run build",
        readiness: "curl -f localhost:3000",
      }),
    ).toBe("build, readiness");
  });
});
