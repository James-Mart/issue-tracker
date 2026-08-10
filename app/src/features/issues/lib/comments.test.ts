import { describe, expect, it } from "vitest";
import { supportsComments } from "./comments";

describe("supportsComments", () => {
  it("is false for project", () => {
    expect(supportsComments("project")).toBe(false);
  });

  it("is true for idea, epic, story, and task", () => {
    expect(supportsComments("idea")).toBe(true);
    expect(supportsComments("epic")).toBe(true);
    expect(supportsComments("story")).toBe(true);
    expect(supportsComments("task")).toBe(true);
  });
});
