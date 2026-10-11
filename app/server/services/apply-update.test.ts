import { describe, expect, it } from "vitest";
import {
  baseDoc,
  epicChildren,
  loadService,
  readIssue,
  useApplyTestFixtures,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — update preserves imperative progress state", () => {
  it("keeps progress fields and comments.jsonl when the doc updates a node", async () => {
    const { apply, update, appendComment, readComments } = await loadService();
    await apply(baseDoc());

    // Stamp imperative/runtime state that lives outside the doc.
    await update("epic-a", { retro: "in-progress" });
    // `merged` lands before `worktreePath` so the merge flip has no checkout
    // to remove; lifecycle removal is covered in cli-story-worktree-lifecycle.
    await update("b2", { merged: true });
    await update("b2", {
      branchName: "feat/b2",
      worktreePath: "/root/issue-tracker-worktrees/proj/b2",
      worktreeSetupFailed: true,
      prUrl: "https://example.test/pr/2",
      merged: true,
      review: "failed",
      retro: "in-progress",
      needsAttention: true,
      attentionReason: "waiting on review",
    });
    await update("c1", {
      status: "in-progress",
      commits: ["deadbeef00000000000000000000000000000000"],
      noDiff: true,
      assignee: "bob",
      needsAttention: true,
      attentionReason: "verify locally",
    });
    await appendComment("b2", { role: "agent", body: "progress note" });

    // Re-apply with changed titles so b2 and c1 actually go through the update path.
    const doc = baseDoc();
    epicChildren(doc)[0].title = "Epic A renamed";
    epicChildren(doc)[0].children![1].title = "Branch two renamed";
    epicChildren(doc)[0].children![0].children![0].title = "Commit one renamed";
    const summary = await apply(doc);
    expect(summary.updated.sort()).toEqual(["b2", "c1", "epic-a"]);
    expect(summary.deleted).toEqual([]);

    const epicA = readIssue("epic-a");
    expect(epicA.title).toBe("Epic A renamed");
    expect(epicA.retro).toBe("in-progress");

    const b2 = readIssue("b2");
    expect(b2.title).toBe("Branch two renamed");
    expect(b2.branchName).toBe("feat/b2");
    expect(b2.worktreePath).toBe("/root/issue-tracker-worktrees/proj/b2");
    expect(b2.kind === "story" && b2.worktreeSetupFailed).toBe(true);
    expect(b2.mergeBase).toBeUndefined();
    expect(b2.prUrl).toBe("https://example.test/pr/2");
    expect(b2.merged).toBe(true);
    expect(b2.kind === "story" && typeof b2.mergedAt).toBe("string");
    expect(b2.review).toBe("failed");
    expect(b2.retro).toBe("in-progress");
    expect("assignee" in b2).toBe(false);
    expect(b2.needsAttention).toBe(true);
    expect(b2.attentionReason).toBe("waiting on review");

    const c1 = readIssue("c1");
    expect(c1.title).toBe("Commit one renamed");
    expect(c1.status).toBe("in-progress");
    expect(c1.commits).toEqual(["deadbeef00000000000000000000000000000000"]);
    expect(c1.noDiff).toBe(true);
    expect(c1.assignee).toBe("bob");
    expect(c1.needsAttention).toBe(true);
    expect(c1.attentionReason).toBe("verify locally");

    const comments = readComments("b2");
    expect(comments.problems).toEqual([]);
    expect(comments.messages.map((m) => m.body)).toEqual(["progress note"]);
  });
});
