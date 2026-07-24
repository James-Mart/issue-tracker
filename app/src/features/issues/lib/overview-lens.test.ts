import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERVIEW_LENS,
  parseOverviewLens,
  writeOverviewLensParam,
} from "./overview-lens";

describe("parseOverviewLens", () => {
  it("defaults absent and unknown values to flow", () => {
    expect(parseOverviewLens(null)).toBe(DEFAULT_OVERVIEW_LENS);
    expect(parseOverviewLens("")).toBe("flow");
    expect(parseOverviewLens("other")).toBe("flow");
  });

  it("accepts the three lens ids", () => {
    expect(parseOverviewLens("flow")).toBe("flow");
    expect(parseOverviewLens("structure")).toBe("structure");
    expect(parseOverviewLens("dependencies")).toBe("dependencies");
  });
});

describe("writeOverviewLensParam", () => {
  it("omits the param for the default flow lens", () => {
    const params = new URLSearchParams("lens=structure&x=1");
    expect(writeOverviewLensParam(params, "flow").toString()).toBe("x=1");
  });

  it("sets lens for non-default selections", () => {
    const params = new URLSearchParams("x=1");
    expect(writeOverviewLensParam(params, "structure").toString()).toBe(
      "x=1&lens=structure",
    );
    expect(writeOverviewLensParam(params, "dependencies").get("lens")).toBe(
      "dependencies",
    );
  });
});
