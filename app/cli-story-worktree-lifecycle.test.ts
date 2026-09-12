import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  createCleanWorktree,
  failGitWorktreeRemove,
  seedImplementingSession,
  useStoryWorktreeCliFixtures,
  withIssuesDir,
} from "./cli-story-worktree.test-fixtures.js";
import { env, issueJsonField } from "./cli.test-helpers.js";
import { applyMergeConsequences } from "./server/services/merge-consequences.js";

useStoryWorktreeCliFixtures();

describe("lifecycle worktree removal", () => {
  it("removes a clean worktree when the Story is merged", async () => {
    const path = await createCleanWorktree();
    await withIssuesDir(() => applyMergeConsequences("a"));
    expect(existsSync(path)).toBe(false);
    expect(issueJsonField("a", "worktreePath")).toBeUndefined();
    expect(issueJsonField("a", "merged")).toBe(true);
  });

  it("removes a clean worktree when the Story is archived", async () => {
    const path = await createCleanWorktree();
    const result = await runIssueCli(["story", "set", "a", "archived", "true"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(existsSync(path)).toBe(false);
    expect(issueJsonField("a", "worktreePath")).toBeUndefined();
    expect(issueJsonField("a", "archived")).toBe(true);
  });

  it("removes a clean worktree when the Story is deleted", async () => {
    const path = await createCleanWorktree();
    const result = await runIssueCli(["story", "delete", "a"], { env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deleted a");
    expect(result.stdout).not.toMatch(/retained worktree/);
    expect(existsSync(path)).toBe(false);
  });

  it("removes a clean worktree when the Story is merged while a session is live", async () => {
    const path = await createCleanWorktree();
    seedImplementingSession("conv-live", "a", "p", { live: true });
    await withIssuesDir(() => applyMergeConsequences("a"));
    expect(existsSync(path)).toBe(false);
    expect(issueJsonField("a", "worktreePath")).toBeUndefined();
    expect(issueJsonField("a", "merged")).toBe(true);
  });

  it("removes a clean worktree when the Story is archived while a session is live", async () => {
    const path = await createCleanWorktree();
    seedImplementingSession("conv-live", "a", "p", { live: true });
    const result = await runIssueCli(["story", "set", "a", "archived", "true"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(existsSync(path)).toBe(false);
    expect(issueJsonField("a", "worktreePath")).toBeUndefined();
    expect(issueJsonField("a", "archived")).toBe(true);
  });

  it("removes a clean worktree when the Story is deleted while a session is live", async () => {
    const path = await createCleanWorktree();
    seedImplementingSession("conv-live", "a", "p", { live: true });
    const result = await runIssueCli(["story", "delete", "a"], { env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deleted a");
    expect(result.stdout).not.toMatch(/retained worktree/);
    expect(existsSync(path)).toBe(false);
  });

  it("keeps a dirty worktree when merge refuses removal", async () => {
    const path = await createCleanWorktree();
    writeFileSync(join(path, "README"), "dirty\n");
    seedImplementingSession("conv-live", "a", "p", { live: true });
    await withIssuesDir(() => applyMergeConsequences("a"));
    expect(issueJsonField("a", "merged")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(issueJsonField("a", "worktreePath")).toBe(path);
    const worktree = await runIssueCli(["story", "get", "a", "worktree"], {
      env: env(),
    });
    expect(JSON.parse(worktree.stdout)).toMatchObject({
      exists: true,
      retained: true,
    });
  });

  it("keeps a dirty worktree when archive refuses removal", async () => {
    const path = await createCleanWorktree();
    writeFileSync(join(path, "README"), "dirty\n");
    seedImplementingSession("conv-live", "a", "p", { live: true });
    const result = await runIssueCli(["story", "set", "a", "archived", "true"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(issueJsonField("a", "archived")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(issueJsonField("a", "worktreePath")).toBe(path);
    const worktree = await runIssueCli(["story", "get", "a", "worktree"], {
      env: env(),
    });
    expect(JSON.parse(worktree.stdout)).toMatchObject({
      exists: true,
      retained: true,
    });
  });

  it("deletes the Story and names the path when removal is refused", async () => {
    const path = await createCleanWorktree();
    writeFileSync(join(path, "README"), "dirty\n");
    seedImplementingSession("conv-live", "a", "p", { live: true });
    const result = await runIssueCli(["story", "delete", "a"], { env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deleted a");
    expect(result.stdout).toContain(`retained worktree for a at ${path}`);
    expect(existsSync(path)).toBe(true);
    expect(
      (await runIssueCli(["story", "view", "a"], { env: env() })).status,
    ).not.toBe(0);
  });

  it("fails merge when worktree remove hits git-failed", async () => {
    const path = await createCleanWorktree();
    failGitWorktreeRemove();
    await expect(
      withIssuesDir(() => applyMergeConsequences("a")),
    ).rejects.toMatchObject({ code: "git-failed" });
    expect(issueJsonField("a", "merged")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(issueJsonField("a", "worktreePath")).toBe(path);
  });

  it("fails archive when worktree remove hits git-failed", async () => {
    const path = await createCleanWorktree();
    failGitWorktreeRemove();
    const result = await runIssueCli(["story", "set", "a", "archived", "true"], {
      env: env(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/fake worktree remove failure/);
    expect(issueJsonField("a", "archived")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(issueJsonField("a", "worktreePath")).toBe(path);
  });

  it("fails delete when worktree remove hits git-failed and does not report retained", async () => {
    const path = await createCleanWorktree();
    failGitWorktreeRemove();
    const result = await runIssueCli(["story", "delete", "a"], { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/fake worktree remove failure/);
    expect(result.stdout).not.toMatch(/deleted a/);
    expect(result.stdout).not.toMatch(/retained worktree/);
    expect(existsSync(path)).toBe(true);
    expect(
      (await runIssueCli(["story", "view", "a"], { env: env() })).status,
    ).toBe(0);
    expect(issueJsonField("a", "worktreePath")).toBe(path);
  });
});
