import { describe, expect, it } from "vitest";
import { roleFamily } from "./role-family";

describe("roleFamily", () => {
  it("splits a variant-suffixed role into family and variant", () => {
    expect(roleFamily("issue-tracker-implementor-composer")).toEqual({
      family: "issue-tracker-implementor",
      variant: "composer",
    });
  });

  it("does not treat an embedded model token as a variant suffix", () => {
    expect(roleFamily("issue-tracker-sonnet-writer")).toEqual({
      family: "issue-tracker-sonnet-writer",
    });
  });

  it("returns a plain role unchanged as the family", () => {
    expect(roleFamily("issue-tracker-implementor")).toEqual({
      family: "issue-tracker-implementor",
    });
  });
});
