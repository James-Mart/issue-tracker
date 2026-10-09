import { describe, expect, it } from "vitest";
import { commentHeaderLabels, isHumanRole } from "./message";

describe("isHumanRole", () => {
  it("treats human as the composer role", () => {
    expect(isHumanRole("human")).toBe(true);
  });

  it("treats agent and other roles as non-human", () => {
    expect(isHumanRole("agent")).toBe(false);
    expect(isHumanRole("implementor")).toBe(false);
  });
});

describe("commentHeaderLabels", () => {
  it("uses the stored name for human comments without a role badge", () => {
    expect(commentHeaderLabels("human", "ada")).toEqual({ author: "ada" });
  });

  it('shows "Human" when a human comment has no stored name', () => {
    expect(commentHeaderLabels("human")).toEqual({ author: "Human" });
    expect(commentHeaderLabels("human", "   ")).toEqual({ author: "Human" });
  });

  it("trims human display names", () => {
    expect(commentHeaderLabels("human", "  ada  ")).toEqual({ author: "ada" });
  });
});
