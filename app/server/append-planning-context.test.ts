import { describe, expect, it } from "vitest";
import {
  APPEND_PLANNING_MERGE_BASE_RESEARCH,
  APPEND_PLANNING_WORKTREE_RESEARCH,
  appendPlanningResearchSentence,
} from "./append-planning-context";

describe("appendPlanningResearchSentence", () => {
  it("omits research copy unless append planning is open", () => {
    expect(appendPlanningResearchSentence({ status: "merged" })).toBeUndefined();
    expect(
      appendPlanningResearchSentence({
        status: "closed",
        reason: "parent-has-no-branch",
      }),
    ).toBeUndefined();
    expect(
      appendPlanningResearchSentence({
        status: "closed",
        reason: "merge-base-unresolved",
      }),
    ).toBeUndefined();
    expect(
      appendPlanningResearchSentence({ status: "open", context: "worktree" }),
    ).toBe(APPEND_PLANNING_WORKTREE_RESEARCH);
    expect(
      appendPlanningResearchSentence({
        status: "open",
        context: "merge-base",
        mergeBase: "main",
      }),
    ).toBe(APPEND_PLANNING_MERGE_BASE_RESEARCH);
  });
});
