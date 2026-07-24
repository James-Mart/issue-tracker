import { describe, expect, it } from "vitest";
import { initialsFromName } from "./avatar";

describe("initialsFromName", () => {
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
