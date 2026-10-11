import { describe, expect, it } from "vitest";
import { mergeIssue } from "./merge";
import type { Issue } from "../schemas";

type CommitIssue = Extract<Issue, { kind: "task" }>;
const asCommit = (issue: Issue): CommitIssue => issue as CommitIssue;

const commit: CommitIssue = {
  id: "login-route",
  kind: "task",
  title: "Add login route",
  partOf: "auth-endpoints",
  order: 0,
  status: "todo",
  commits: [],
  needsAttention: false,
  attentionReason: null,
  archived: false,
  createdAt: "2026-07-09T14:36:00.000Z",
  updatedAt: "2026-07-09T14:36:00.000Z",
};

describe("mergeIssue", () => {
  it("ignores undefined patch fields (no blind overwrite)", () => {
    const merged = mergeIssue(commit, { status: undefined });
    expect(merged.kind === "task" && merged.status).toBe("todo");
  });

  it("clears a clearable optional field when patched with null", () => {
    const assigned = asCommit(
      mergeIssue(commit, { assignee: "codex", commits: ["abc"] }),
    );
    expect(assigned.assignee).toBe("codex");
    const cleared = mergeIssue(assigned, { assignee: null, commits: [] });
    expect("assignee" in cleared).toBe(false);
    expect(cleared.kind === "task" && cleared.commits).toEqual([]);
  });
});
