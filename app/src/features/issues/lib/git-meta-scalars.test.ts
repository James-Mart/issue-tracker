import { describe, expect, it } from "vitest";
import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail } from "@server/schemas";
import { storyGitMetaScalars, taskGitMetaScalars } from "./git-meta-scalars";

function story(
  overrides: Partial<Extract<IssueDetail, { kind: "story" }>> = {},
): Extract<IssueDetail, { kind: "story" }> {
  return {
    id: "s",
    kind: "story",
    title: "S",
    description: "",
    partOf: "e",
    order: 0,
    merged: false,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function task(
  overrides: Partial<Extract<IssueDetail, { kind: "task" }>> = {},
): Extract<IssueDetail, { kind: "task" }> {
  return {
    id: "t",
    kind: "task",
    title: "T",
    description: "",
    partOf: "s",
    order: 0,
    status: "todo",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("storyGitMetaScalars", () => {
  it("always includes editable stackedOn and merged", () => {
    const keys = storyGitMetaScalars(story()).map((s) => s.key);
    expect(keys).toEqual(["stackedOn", "merged"]);
  });

  it("adds present readonly scalars with operator Voice labels", () => {
    const scalars = storyGitMetaScalars(
      story({
        branchName: "feat/a",
        prUrl: "https://example.test/pr/1",
        specReview: "passed",
      }),
      "main",
    );
    expect(scalars).toEqual([
      { key: "branchName", label: FIELD_LABELS.branchName },
      { key: "mergeBase", label: FIELD_LABELS.mergeBase },
      { key: "stackedOn", label: FIELD_LABELS.stackedOn },
      { key: "prUrl", label: FIELD_LABELS.prUrl },
      { key: "merged", label: FIELD_LABELS.merged },
      { key: "specReview", label: FIELD_LABELS.specReview },
    ]);
    expect(FIELD_LABELS.branchName).toBe("Branch");
    expect(FIELD_LABELS.prUrl).toBe("Pull request");
  });

  it("omits unset mergeBase and absent readonly fields", () => {
    const keys = storyGitMetaScalars(story(), "(unset)").map((s) => s.key);
    expect(keys).toEqual(["stackedOn", "merged"]);
  });
});

describe("taskGitMetaScalars", () => {
  it("returns empty when nothing is present", () => {
    expect(taskGitMetaScalars(task())).toEqual([]);
  });

  it("includes present parent branch, commit, noDiff, and qa", () => {
    const scalars = taskGitMetaScalars(
      task({ commitSha: "abc123", noDiff: true, qa: "passed" }),
      "feat/a",
    );
    expect(scalars.map((s) => s.key)).toEqual([
      "branchName",
      "commitSha",
      "noDiff",
      "qa",
    ]);
    expect(scalars.find((s) => s.key === "commitSha")?.label).toBe("Commit");
  });
});
