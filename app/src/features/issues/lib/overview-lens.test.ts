import { describe, expect, it } from "vitest";
import { DEFAULT_OVERVIEW_LENS, parseOverviewLens } from "./overview-lens";

describe("parseOverviewLens", () => {
  it("defaults absent, unknown, and legacy flow values to structure", () => {
    expect(parseOverviewLens(null)).toBe(DEFAULT_OVERVIEW_LENS);
    expect(parseOverviewLens("")).toBe("structure");
    expect(parseOverviewLens("other")).toBe("structure");
    expect(parseOverviewLens("dependencies")).toBe("structure");
    expect(parseOverviewLens("flow")).toBe("structure");
  });

  it("accepts the two lens ids", () => {
    expect(parseOverviewLens("structure")).toBe("structure");
    expect(parseOverviewLens("overview")).toBe("overview");
  });
});

