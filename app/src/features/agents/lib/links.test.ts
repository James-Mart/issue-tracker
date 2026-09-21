import { describe, expect, it } from "vitest";
import { AGENTS_PATH, agentsConversationPath } from "./links";

describe("AGENTS_PATH", () => {
  it("is the agents roster route", () => {
    expect(AGENTS_PATH).toBe("/agents");
  });
});

describe("agentsConversationPath", () => {
  it("builds the selected conversation route", () => {
    expect(agentsConversationPath("conv-1")).toBe("/agents/conv-1");
  });
});
