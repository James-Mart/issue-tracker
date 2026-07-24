import { describe, expect, it } from "vitest";
import { kindHasOwnFlow } from "./own-flow";

describe("kindHasOwnFlow", () => {
  it("is true for epic and story", () => {
    expect(kindHasOwnFlow("epic")).toBe(true);
    expect(kindHasOwnFlow("story")).toBe(true);
  });

  it("is false for idea, task, and project", () => {
    expect(kindHasOwnFlow("idea")).toBe(false);
    expect(kindHasOwnFlow("task")).toBe(false);
    expect(kindHasOwnFlow("project")).toBe(false);
  });
});
