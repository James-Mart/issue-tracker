import { describe, expect, it } from "vitest";
import { initialsFromName, projectAvatarFromId } from "./avatar";

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
    expect(initialsFromName("cursor-grok-4.6-high-fast")).toBe("G");
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

describe("projectAvatarFromId", () => {
  it("derives initials from the project title", () => {
    expect(projectAvatarFromId("alpha", "Alpha Project").initials).toBe("AP");
    expect(projectAvatarFromId("alpha", "Beta").initials).toBe("BE");
  });

  it("keeps color stable for the same project id", () => {
    const first = projectAvatarFromId("my-project", "My Project");
    const renamed = projectAvatarFromId("my-project", "Renamed Project");
    expect(first.colorClass).toBe(renamed.colorClass);
    expect(renamed.initials).toBe("RP");
  });

  it("can differ in color across project ids", () => {
    const colors = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map(
        (id) => projectAvatarFromId(id, "Same Title").colorClass,
      ),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("uses token-backed tailwind background classes", () => {
    const { colorClass } = projectAvatarFromId("issue-tracker", "issue-tracker");
    expect(colorClass).toMatch(/^bg-/);
    expect(colorClass).toMatch(/text-/);
  });
});
