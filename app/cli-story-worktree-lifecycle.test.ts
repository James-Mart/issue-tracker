import { existsSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  createCleanWorktree,
  failGitWorktreeRemove,
  git,
  seedImplementingSession,
  useStoryWorktreeCliFixtures,
  withIssuesDir,
} from "./cli-story-worktree.test-fixtures.js";
import { env, issueJsonField } from "./cli.test-helpers.js";
import { update } from "./server/services/issues.js";

useStoryWorktreeCliFixtures();

describe("lifecycle worktree removal", () => {
  it("removes a clean worktree when the Story is merged", async () => {
    const path = await createCleanWorktree();
    await withIssuesDir(() => update("a", { merged: true }));
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
    await withIssuesDir(() => update("a", { merged: true }));
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
    await withIssuesDir(() => update("a", { merged: true }));
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
      withIssuesDir(() => update("a", { merged: true })),
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

  it("clears worktreePath on merge when the directory is already gone", async () => {
    const path = await createCleanWorktree("gone-a");
    const workspace = issueJsonField<string>("p", "workspace");
    rmSync(path, { recursive: true, force: true });
    await withIssuesDir(() => update("gone-a", { merged: true }));
    expect(issueJsonField("gone-a", "merged")).toBe(true);
    expect(issueJsonField("gone-a", "worktreePath")).toBeUndefined();
    expect(git(workspace, ["worktree", "list", "--porcelain"]).split("\n")).not.toContain(
      `worktree ${path}`,
    );
  });

  it("clears worktreePath on archive when the directory is already gone", async () => {
    const path = await createCleanWorktree("gone-a");
    const workspace = issueJsonField<string>("p", "workspace");
    rmSync(path, { recursive: true, force: true });
    const result = await runIssueCli(["story", "set", "gone-a", "archived", "true"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(issueJsonField("gone-a", "archived")).toBe(true);
    expect(issueJsonField("gone-a", "worktreePath")).toBeUndefined();
    expect(git(workspace, ["worktree", "list", "--porcelain"]).split("\n")).not.toContain(
      `worktree ${path}`,
    );
  });

  it("deletes the Story without reporting retained when the directory is already gone", async () => {
    const path = await createCleanWorktree("gone-a");
    const workspace = issueJsonField<string>("p", "workspace");
    rmSync(path, { recursive: true, force: true });
    const result = await runIssueCli(["story", "delete", "gone-a"], { env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deleted gone-a");
    expect(result.stdout).not.toMatch(/retained worktree/);
    expect(git(workspace, ["worktree", "list", "--porcelain"]).split("\n")).not.toContain(
      `worktree ${path}`,
    );
  });

  it("clears worktreePath on merge and leaves a locked registration when the directory is already gone", async () => {
    const path = await createCleanWorktree("gone-a");
    const workspace = issueJsonField<string>("p", "workspace");
    git(workspace, ["worktree", "lock", path]);
    rmSync(path, { recursive: true, force: true });
    await withIssuesDir(() => update("gone-a", { merged: true }));
    expect(issueJsonField("gone-a", "merged")).toBe(true);
    expect(issueJsonField("gone-a", "worktreePath")).toBeUndefined();
    const record = git(workspace, ["worktree", "list", "--porcelain"])
      .split("\n\n")
      .find((block) => block.startsWith(`worktree ${path}\n`));
    expect(record).toContain("\nlocked");
  });

  it("keeps a locked worktree when merge refuses removal", async () => {
    const path = await createCleanWorktree("locked-merge");
    const workspace = issueJsonField<string>("p", "workspace");
    git(workspace, ["worktree", "lock", path]);
    await withIssuesDir(() => update("locked-merge", { merged: true }));
    expect(issueJsonField("locked-merge", "merged")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(issueJsonField("locked-merge", "worktreePath")).toBe(path);
    const worktree = await runIssueCli(["story", "get", "locked-merge", "worktree"], {
      env: env(),
    });
    expect(JSON.parse(worktree.stdout)).toMatchObject({
      exists: true,
      retained: true,
      locked: true,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
    });
    git(workspace, ["worktree", "unlock", path]);
  });

  it("keeps a locked worktree when archive refuses removal", async () => {
    const path = await createCleanWorktree("locked-archive");
    const workspace = issueJsonField<string>("p", "workspace");
    git(workspace, ["worktree", "lock", path]);
    const result = await runIssueCli(["story", "set", "locked-archive", "archived", "true"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(issueJsonField("locked-archive", "archived")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(issueJsonField("locked-archive", "worktreePath")).toBe(path);
    git(workspace, ["worktree", "unlock", path]);
  });

  it("deletes the Story and names the path when a locked worktree is refused", async () => {
    const path = await createCleanWorktree("locked-delete");
    const workspace = issueJsonField<string>("p", "workspace");
    git(workspace, ["worktree", "lock", path]);
    const result = await runIssueCli(["story", "delete", "locked-delete"], { env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deleted locked-delete");
    expect(result.stdout).toContain(`retained worktree for locked-delete at ${path}`);
    expect(existsSync(path)).toBe(true);
    git(workspace, ["worktree", "unlock", path]);
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
