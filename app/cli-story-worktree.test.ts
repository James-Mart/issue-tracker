import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  addSubmodule,
  git,
  initRepo,
  initSubmoduleInWorktree,
  seedImplementingSession,
  seedProject,
  trackWorktree,
  useStoryWorktreeCliFixtures,
  writeStory,
} from "./cli-story-worktree.test-fixtures.js";
import { env, issueJsonField, nextAt, writeIssue } from "./cli.test-helpers.js";

useStoryWorktreeCliFixtures();

describe("story worktree create", () => {
  it("creates a worktree off the parent branch for a stacked Story", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    writeIssue("parent", {
      kind: "story",
      title: "Parent",
      partOf: "e",
      branchName: "parent",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    git(workspace, ["branch", "parent"]);
    writeIssue("child", {
      kind: "story",
      title: "Child",
      partOf: "e",
      stackedOn: "parent",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const expectedPath = trackWorktree(workspace, "p", "child");
    const result = await runIssueCli(["story", "worktree", "create", "child"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expectedPath);
    expect(git(expectedPath, ["merge-base", "HEAD", "parent"])).toBe(
      git(workspace, ["rev-parse", "parent"]),
    );
  });
});

describe("story worktree remove", () => {
  it("refuses removal when the only dirt is inside a submodule", async () => {
    const workspace = initRepo();
    addSubmodule(workspace, "libs/foo");
    seedProject(workspace);
    writeStory("a");

    const expectedPath = trackWorktree(workspace, "p", "a");
    expect(
      (await runIssueCli(["story", "worktree", "create", "a"], { env: env() })).status,
    ).toBe(0);
    const subPath = initSubmoduleInWorktree(expectedPath, "libs/foo");
    writeFileSync(join(subPath, "bar.txt"), "sub dirty\n");
    writeFileSync(join(subPath, "extra.txt"), "new\n");

    const result = await runIssueCli(["story", "worktree", "remove", "a"], {
      env: env(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/2 uncommitted change\(s\), 0 at-risk commit\(s\)/);
    expect(existsSync(expectedPath)).toBe(true);
    expect(issueJsonField("a", "worktreePath")).toBe(expectedPath);
  });

  it("refuses removal when at-risk commits exist and leaves the checkout", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    writeStory("a");

    const expectedPath = trackWorktree(workspace, "p", "a");
    expect(
      (await runIssueCli(["story", "worktree", "create", "a"], { env: env() })).status,
    ).toBe(0);
    expect(
      (await runIssueCli(["story", "set", "a", "branchName", "a"], { env: env() })).status,
    ).toBe(0);
    writeFileSync(join(expectedPath, "wip.txt"), "wip\n");
    git(expectedPath, ["add", "wip.txt"]);
    git(expectedPath, ["commit", "-m", "wip"]);

    const result = await runIssueCli(["story", "worktree", "remove", "a"], {
      env: env(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/0 uncommitted change\(s\), 1 at-risk commit\(s\)/);
    expect(existsSync(expectedPath)).toBe(true);
    expect(issueJsonField("a", "worktreePath")).toBe(expectedPath);
  });

  it("refuses --discard while an implementing session is active", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    writeStory("a");

    const expectedPath = trackWorktree(workspace, "p", "a");
    expect(
      (await runIssueCli(["story", "worktree", "create", "a"], { env: env() })).status,
    ).toBe(0);
    writeFileSync(join(expectedPath, "README"), "dirty\n");
    seedImplementingSession("conv-live", "a", "p", { live: true });

    const result = await runIssueCli(["story", "worktree", "remove", "a", "--discard"], {
      env: env(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/implementing session is active/);
    expect(existsSync(expectedPath)).toBe(true);
    expect(issueJsonField("a", "worktreePath")).toBe(expectedPath);
  });
});
