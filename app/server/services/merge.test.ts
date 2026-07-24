import { describe, expect, it } from "vitest";
import { mergeIssue } from "./merge";
import type { Issue } from "../schemas";

type CommitIssue = Extract<Issue, { kind: "task" }>;
const asCommit = (issue: Issue): CommitIssue => issue as CommitIssue;

const commit: Issue = {
  id: "login-route",
  kind: "task",
  title: "Add login route",
  partOf: "auth-endpoints",
  order: 0,
  status: "todo",
  needsAttention: false,
  attentionReason: null,
  createdAt: "2026-07-09T14:36:00.000Z",
  updatedAt: "2026-07-09T14:36:00.000Z",
};

describe("mergeIssue", () => {
  it("changes only the named field and preserves the rest", () => {
    const merged = mergeIssue(commit, { status: "done" });
    expect(merged.kind === "task" && merged.status).toBe("done");
    expect(merged.title).toBe(commit.title);
    expect(merged.kind === "task" && merged.partOf).toBe(commit.partOf);
    expect(merged.createdAt).toBe(commit.createdAt);
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(commit);
    mergeIssue(commit, { status: "done", commitSha: "abc123" });
    expect(JSON.stringify(commit)).toBe(before);
  });

  it("ignores undefined patch fields (no blind overwrite)", () => {
    const merged = mergeIssue(commit, { status: undefined });
    expect(merged.kind === "task" && merged.status).toBe("todo");
  });

  it("applies null attentionReason explicitly", () => {
    const flagged = asCommit(
      mergeIssue(commit, {
        needsAttention: true,
        attentionReason: "stuck",
      }),
    );
    expect(flagged.needsAttention).toBe(true);
    expect(flagged.attentionReason).toBe("stuck");
    const cleared = asCommit(mergeIssue(flagged, { attentionReason: null }));
    expect(cleared.attentionReason).toBeNull();
    expect(cleared.needsAttention).toBe(true);
  });

  it("merges multiple fields at once", () => {
    const merged = asCommit(
      mergeIssue(commit, {
        status: "done",
        commitSha: "deadbeef",
        assignee: "codex",
      }),
    );
    expect(merged.status).toBe("done");
    expect(merged.commitSha).toBe("deadbeef");
    expect(merged.assignee).toBe("codex");
  });

  it("does not touch updatedAt (the service owns timestamps)", () => {
    const merged = mergeIssue(commit, { status: "done" });
    expect(merged.updatedAt).toBe(commit.updatedAt);
  });

  it("clears a clearable optional field when patched with null", () => {
    const assigned = asCommit(
      mergeIssue(commit, { assignee: "codex", commitSha: "abc" }),
    );
    expect(assigned.assignee).toBe("codex");
    const cleared = mergeIssue(assigned, { assignee: null, commitSha: null });
    expect("assignee" in cleared).toBe(false);
    expect(cleared.kind === "task" && "commitSha" in cleared).toBe(false);
  });

  it("keeps a null attentionReason as an explicit value, not a deletion", () => {
    const merged = asCommit(mergeIssue(commit, { attentionReason: null }));
    expect("attentionReason" in merged).toBe(true);
    expect(merged.attentionReason).toBeNull();
  });

  it("sets noDiff when patched with true", () => {
    const merged = asCommit(mergeIssue(commit, { noDiff: true }));
    expect(merged.noDiff).toBe(true);
  });

  it("clears noDiff when patched with false", () => {
    const flagged = asCommit(mergeIssue(commit, { noDiff: true }));
    expect(flagged.noDiff).toBe(true);
    const cleared = asCommit(mergeIssue(flagged, { noDiff: false }));
    expect("noDiff" in cleared).toBe(false);
  });

  it("leaves noDiff unchanged when the patch omits it", () => {
    const flagged = asCommit(mergeIssue(commit, { noDiff: true }));
    const merged = asCommit(mergeIssue(flagged, { status: "done" }));
    expect(merged.noDiff).toBe(true);
    expect(merged.status).toBe("done");
  });
});
