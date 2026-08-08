import { describe, expect, it } from "vitest";
import { initialsFromName } from "./avatar";

describe("initialsFromName", () => {
  it("maps composer family names to C", () => {
    expect(initialsFromName("composer")).toBe("C");
    expect(initialsFromName("Composer")).toBe("C");
    expect(initialsFromName("composer-2.5")).toBe("C");
    expect(initialsFromName("issue-tracker-implementor-composer")).toBe("C");
  });

  it("maps grok family names to G", () => {
    expect(initialsFromName("grok")).toBe("G");
    expect(initialsFromName("cursor-grok-4.5-high-fast")).toBe("G");
  });

  it("maps opus family names to O", () => {
    expect(initialsFromName("opus")).toBe("O");
    expect(initialsFromName("claude-opus-5-thinking-high")).toBe("O");
  });

  it("takes two letters from a single word", () => {
    expect(initialsFromName("coordinator")).toBe("CO");
  });

  it("uses first and last word initials", () => {
    expect(initialsFromName("James Mart")).toBe("JM");
  });

  it("strips a leading @", () => {
    expect(initialsFromName("@alice")).toBe("AL");
  });

  it("returns ? for empty input", () => {
    expect(initialsFromName("   ")).toBe("?");
  });
});
