import { describe, expect, it } from "vitest";
import {
  ADD_IDEA_HELPER,
  MERGED_APPEND_REASON,
  NO_BRANCH_MERGE_BASE_REASON,
  appendIdeaTitle,
  mergeBaseHelper,
  storyAppendAvailability,
} from "./story-append-actions";

describe("storyAppendAvailability", () => {
  it("enables both actions on an open Story with a branch", () => {
    expect(
      storyAppendAvailability({ merged: false, branchName: "story/oauth" }),
    ).toEqual({ ideaEnabled: true, mergeBaseEnabled: true });
  });

  it("keeps the Idea action enabled when the Story has no branch", () => {
    expect(storyAppendAvailability({ merged: false })).toEqual({
      ideaEnabled: true,
      mergeBaseEnabled: false,
      mergeBaseReason: NO_BRANCH_MERGE_BASE_REASON,
    });
  });

  it("disables both actions on a merged Story with a card-level reason", () => {
    expect(
      storyAppendAvailability({
        merged: true,
        branchName: "story/landed",
      }),
    ).toEqual({
      ideaEnabled: false,
      mergeBaseEnabled: false,
      cardReason: MERGED_APPEND_REASON,
    });
  });
});

describe("append copy", () => {
  it("names PR feedback as an example in the Idea helper", () => {
    expect(ADD_IDEA_HELPER).toContain("PR feedback");
  });

  it("names both refs in the merge-base helper", () => {
    expect(mergeBaseHelper("main @ c4d91e2", "story/oauth")).toBe(
      "Appends one predefined task to merge main @ c4d91e2 into story/oauth and reconcile conflicts.",
    );
  });

  it("titles the created Idea from the Story", () => {
    expect(appendIdeaTitle("OAuth callback hardening")).toBe(
      "Append to OAuth callback hardening",
    );
  });
});
