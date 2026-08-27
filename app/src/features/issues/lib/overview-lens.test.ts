import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERVIEW_LENS,
  parseOverviewLens,
  writeOverviewLensParam,
} from "./overview-lens";

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

describe("writeOverviewLensParam", () => {
  it("omits the param for the default structure lens", () => {
    const params = new URLSearchParams("lens=overview&x=1");
    expect(writeOverviewLensParam(params, "structure").toString()).toBe("x=1");
  });

  it("sets lens for non-default selections", () => {
    const params = new URLSearchParams("x=1");
    expect(writeOverviewLensParam(params, "overview").toString()).toBe(
      "x=1&lens=overview",
    );
  });
});
