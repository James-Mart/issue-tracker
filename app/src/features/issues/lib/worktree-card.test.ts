import { describe, expect, it } from "vitest";
import type { DerivedWorktree } from "@server/schemas";
import {
  worktreeCardModel,
  worktreeNounCount,
  worktreeRetainedCopy,
} from "./worktree-card";

function worktree(overrides: Partial<DerivedWorktree> = {}): DerivedWorktree {
  return {
    exists: false,
    uncommittedCount: 0,
    atRiskCommitCount: 0,
    retained: false,
    ...overrides,
  };
}

describe("worktreeCardModel", () => {
  it("selects parent-branch from blockedReason even when other flags are set", () => {
    expect(
      worktreeCardModel(
        worktree({
          blockedReason: "parent-branch",
          exists: true,
          path: "/tmp/wt",
          setupFailed: true,
          retained: true,
        }),
      ),
    ).toEqual({ kind: "parent-branch" });
  });

  it("selects parent-branch when there is no path", () => {
    expect(
      worktreeCardModel(worktree({ blockedReason: "parent-branch" })),
    ).toEqual({ kind: "parent-branch" });
  });

  it("selects setup-failed from setupFailed and keeps output fields", () => {
    expect(
      worktreeCardModel(
        worktree({
          exists: true,
          path: "/tmp/wt",
          setupFailed: true,
          setupOutput: "npm ERR! missing",
          setupLogPath: "/tmp/setup.log",
        }),
      ),
    ).toEqual({
      kind: "setup-failed",
      path: "/tmp/wt",
      setupOutput: "npm ERR! missing",
      setupLogPath: "/tmp/setup.log",
    });
  });

  it("selects setup-failed over retained and active", () => {
    expect(
      worktreeCardModel(
        worktree({
          exists: true,
          path: "/tmp/wt",
          setupFailed: true,
          retained: true,
        }),
      )?.kind,
    ).toBe("setup-failed");
  });

  it("selects retained and names the counts", () => {
    expect(
      worktreeCardModel(
        worktree({
          exists: true,
          path: "/tmp/wt",
          retained: true,
          uncommittedCount: 2,
          atRiskCommitCount: 1,
        }),
      ),
    ).toEqual({
      kind: "retained",
      path: "/tmp/wt",
      uncommittedCount: 2,
      atRiskCommitCount: 1,
    });
  });

  it("selects active when exists and none of the blocking flags", () => {
    expect(
      worktreeCardModel(
        worktree({
          exists: true,
          path: "/root/issue-tracker-worktrees/p/s",
        }),
      ),
    ).toEqual({
      kind: "active",
      path: "/root/issue-tracker-worktrees/p/s",
    });
  });

  it("hides a Story with no worktree and no blocked reason", () => {
    expect(worktreeCardModel(undefined)).toBeNull();
    expect(worktreeCardModel(worktree())).toBeNull();
    expect(
      worktreeCardModel(worktree({ path: "/tmp/vanished", exists: false })),
    ).toBeNull();
  });

  it("hides exists without a path", () => {
    expect(worktreeCardModel(worktree({ exists: true }))).toBeNull();
  });
});

describe("worktree retained copy", () => {
  it("pluralizes uncommitted and at-risk counts", () => {
    expect(worktreeNounCount(1, "change", "changes")).toBe("1 change");
    expect(worktreeNounCount(2, "change", "changes")).toBe("2 changes");
    expect(worktreeRetainedCopy(2, 1)).toBe(
      "This checkout outlived its Story — 2 uncommitted changes, 1 at-risk commit.",
    );
    expect(worktreeRetainedCopy(0, 0)).toBe(
      "This checkout outlived its Story — 0 uncommitted changes, 0 at-risk commits.",
    );
  });
});
