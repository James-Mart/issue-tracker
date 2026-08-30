import { describe, expect, it } from "vitest";
import { roleFamily, roleFamilyCaption, roleFamilyTitle } from "./role-family";

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

describe("roleFamilyTitle", () => {
  it("maps a stripped family to its seat title", () => {
    expect(roleFamilyTitle("implementor")).toBe("Implementor");
    expect(roleFamilyTitle("issue-tracker-implementor")).toBe("Implementor");
    expect(roleFamilyTitle("auto-plan-discriminator")).toBe("Discriminator");
  });

  it("keeps the stripped family string when unmapped", () => {
    expect(roleFamilyTitle("validator")).toBe("validator");
    expect(roleFamilyTitle("issue-tracker-polish")).toBe("polish");
  });
});

describe("roleFamilyCaption", () => {
  it("puts the variant on the caption, not the family id", () => {
    expect(roleFamilyCaption("issue-tracker-implementor-composer")).toEqual({
      family: "issue-tracker-implementor",
      variant: "composer",
      caption: "Implementor (composer)",
    });
  });
});
