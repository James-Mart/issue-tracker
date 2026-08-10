import { describe, expect, it } from "vitest";
import { isHumanRole } from "./message";

describe("isHumanRole", () => {
  it("treats human as the composer role", () => {
    expect(isHumanRole("human")).toBe(true);
  });

  it("treats agent and other roles as non-human", () => {
    expect(isHumanRole("agent")).toBe(false);
    expect(isHumanRole("implementor")).toBe(false);
  });
});
