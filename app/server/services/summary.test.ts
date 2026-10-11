import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { Issue } from "../schemas.js";
import { resolveSummaryWorkspace } from "./summary.js";

const AT = "2026-07-09T14:00:00.000Z";

/** Project → Epic → Story. */
const storyIssues: Issue[] = [
  {
    id: "p",
    kind: "project",
    title: "Proj",
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "e",
    kind: "epic",
    title: "Epic",
    partOf: "p",
    blockedBy: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "s",
    kind: "story",
    title: "Story",
    partOf: "e",
    branchName: "feat/s",
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  },
];

const projectWorkspace = "/tmp/project-ws";

function withProjectWorkspace(issues: Issue[]): Issue[] {
  return issues.map((issue) =>
    issue.id === "p" ? { ...issue, workspace: projectWorkspace } : issue,
  );
}

/** The Story tree plus an Idea under the Project; the Story is the append target. */
const ideaIssues: Issue[] = [
  ...storyIssues,
  {
    id: "idea-1",
    kind: "idea",
    title: "Capture",
    partOf: "p",
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  },
];

function ideaChain(issues: Issue[]): Issue[] {
  return issues.filter((i) => ["p", "e", "idea-1"].includes(i.id));
}

function issuesById(issues: Issue[]): Map<string, Issue> {
  return new Map(issues.map((issue) => [issue.id, issue]));
}

describe("resolveSummaryWorkspace", () => {
  it("uses a Story worktree when the directory exists", () => {
    const worktree = mkdtempSync(join(tmpdir(), "story-wt-"));
    try {
      const issues = withProjectWorkspace(
        storyIssues.map((issue) =>
          issue.id === "s"
            ? { ...issue, worktreePath: worktree }
            : issue,
        ),
      );
      expect(resolveSummaryWorkspace(issues, projectWorkspace)).toBe(worktree);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("falls back when the recorded worktree directory no longer exists", () => {
    const issues = withProjectWorkspace(
      storyIssues.map((issue) =>
        issue.id === "s"
          ? { ...issue, worktreePath: "/tmp/vanished-worktree-path" }
          : issue,
      ),
    );
    expect(resolveSummaryWorkspace(issues, projectWorkspace)).toBe(
      projectWorkspace,
    );
  });

  it("uses the append-target Story worktree for an Idea with appendTo", () => {
    const worktree = mkdtempSync(join(tmpdir(), "idea-wt-"));
    try {
      const issues = withProjectWorkspace(
        ideaIssues.map((issue) => {
          if (issue.id === "idea-1") return { ...issue, appendTo: "s" };
          if (issue.id === "s") return { ...issue, worktreePath: worktree };
          return issue;
        }),
      );
      const chain = ideaChain(issues);
      expect(
        resolveSummaryWorkspace(chain, projectWorkspace, issuesById(issues)),
      ).toBe(worktree);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });
});
