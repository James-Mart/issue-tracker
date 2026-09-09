import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { IssueError } from "./errors.js";
import { renderMergeBaseTaskDescription } from "./merge-base-task.js";

describe("renderMergeBaseTaskDescription", () => {
  let previousCwd: string;

  afterEach(() => {
    if (previousCwd) process.chdir(previousCwd);
  });

  it("renders both branchName and mergeBase into the body", () => {
    const body = renderMergeBaseTaskDescription({
      branchName: "feat/story-branch",
      mergeBase: "develop",
    });

    expect(body).toContain("feat/story-branch");
    expect(body).toContain("develop");
    expect(body).not.toMatch(/\{\{/);
  });

  it("reads the template relative to the module, not process.cwd()", () => {
    previousCwd = process.cwd();
    const otherDir = mkdtempSync(join(tmpdir(), "issue-tracker-merge-base-cwd-"));
    process.chdir(otherDir);

    const body = renderMergeBaseTaskDescription({
      branchName: "merge-base-update-action",
      mergeBase: "main",
    });

    expect(body).toContain("merge-base-update-action");
    expect(body).toContain("main");

    rmSync(otherDir, { recursive: true, force: true });
  });

  it("fails when branchName is missing instead of emitting a placeholder", () => {
    expect(() =>
      renderMergeBaseTaskDescription({ branchName: "", mergeBase: "main" }),
    ).toThrow(IssueError);
    expect(() =>
      renderMergeBaseTaskDescription({ branchName: "", mergeBase: "main" }),
    ).toThrow(/branchName/);
  });

  it("fails when mergeBase is missing instead of emitting a placeholder", () => {
    expect(() =>
      renderMergeBaseTaskDescription({
        branchName: "feat/story",
        mergeBase: "",
      }),
    ).toThrow(IssueError);
    expect(() =>
      renderMergeBaseTaskDescription({
        branchName: "feat/story",
        mergeBase: "",
      }),
    ).toThrow(/mergeBase/);
  });
});
