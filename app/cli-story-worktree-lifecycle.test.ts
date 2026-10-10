import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  createCleanWorktree,
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
});
