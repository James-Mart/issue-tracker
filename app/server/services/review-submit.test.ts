import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import type { ReviewSubmission } from "../schemas/review.js";
import {
  AT,
  REVIEW_ID,
  seedReviewTasking,
  useReviewTaskingStore,
  writeReviewTaskingIssue as writeIssue,
} from "./review-tasking.test-fixtures.js";

const SHA = "a".repeat(40);

function seed(): void {
  seedReviewTasking();
  writeIssue("s", {
    kind: "story",
    title: "S",
    partOf: "e",
    branchName: "story-branch",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  const issuesDir = process.env.ISSUES_DIR!;
  writeFileSync(
    join(dirname(issuesDir), "model-slug-catalog.json"),
    JSON.stringify({
      fetchedAt: AT,
      models: [{ id: "grok-4.7", displayName: "Grok 4.7" }],
    }),
  );
}

async function load() {
  const submit = await import("./review-submit.js");
  const issues = await import("./issues.js");
  const threads = await import("./thread-events.js");
  return { ...submit, ...issues, ...threads };
}

function readDescription(id: string): string {
  return readFileSync(join(process.env.ISSUES_DIR!, id, "description.md"), "utf8");
}

describe("submit review as a new idea", () => {
  useReviewTaskingStore("issue-tracker-review-submit-");

  it("queues an Idea on the Story branch, records it, and resolves each thread naming it", async () => {
    seed();
    const {
      submitReview,
      appendComment,
      readAll,
      readComments,
      REVIEW_IDEA_STAKEHOLDER,
      REVIEW_SUBMIT_ROLE,
    } = await load();
    const anchored = await appendComment(REVIEW_ID, {
      role: "human",
      body: "Reject fork PRs here.",
      anchor: { path: "auth-guard.ts", side: "new", line: 42, commitSha: SHA },
    });
    await appendComment(REVIEW_ID, {
      role: "agent",
      name: "Researcher",
      body: "The base repo check lives in pr.ts.",
      replyTo: anchored.id,
    });
    const note = await appendComment(REVIEW_ID, { role: "human", body: "Rename the panel." });

    const view = await submitReview("p", REVIEW_ID, {
      destination: "idea",
      summary: "  Address the guard.  ",
    });

    const ideas = readAll().issues.filter((issue) => issue.kind === "idea");
    expect(ideas).toHaveLength(1);
    const idea = ideas[0]!;
    expect(idea).toMatchObject({
      partOf: "p",
      title: "Review feedback: S",
      stakeholder: REVIEW_IDEA_STAKEHOLDER,
      mergeBase: "story-branch",
    });
    expect(idea.kind === "idea" && idea.planQueuedAt).toBeTruthy();
    expect(idea).not.toHaveProperty("outlineGate");
    expect(idea).not.toHaveProperty("executionGate");
    const description = readDescription(idea.id);
    expect(description).toContain(`review \`${REVIEW_ID}\` of Story \`s\``);
    expect(description).toContain("## Summary\n\nAddress the guard.");
    expect(description).toContain("### `auth-guard.ts:42`\n\n**human:** Reject fork PRs here.");
    expect(description).toContain("**Researcher (agent):** The base repo check lives in pr.ts.");
    expect(description).toContain("### Review comment\n\n**human:** Rename the panel.");

    const recorded = view.submissions[0] as Extract<ReviewSubmission, { status: "done" }>;
    expect(recorded).toMatchObject({
      status: "done",
      threadIds: [anchored.id, note.id],
      taskIds: [],
      ideaId: idea.id,
    });

    const comments = readComments(REVIEW_ID);
    expect(comments.messages.find((m) => m.id === recorded.summaryCommentId)?.body).toBe(
      "Address the guard.",
    );
    for (const threadId of [anchored.id, note.id]) {
      expect(comments.threads.find((t) => t.rootId === threadId)?.state).toBe("resolved");
      const reply = comments.messages.filter((m) => m.replyTo === threadId).at(-1);
      expect(reply).toMatchObject({
        role: REVIEW_SUBMIT_ROLE,
        body: `Handled in follow-up idea [${idea.id}](issue:${idea.id}).`,
      });
    }
  });

  it("resolves only included threads and leaves the rest open", async () => {
    seed();
    const { submitReview, appendComment, readComments, setThreadInclusion } = await load();
    const taken = await appendComment(REVIEW_ID, { role: "human", body: "Take this." });
    const held = await appendComment(REVIEW_ID, { role: "human", body: "Hold this." });
    const mirrored = await appendComment(REVIEW_ID, {
      role: "human",
      body: "From GitHub.",
      source: {
        kind: "github",
        id: "IC_1",
        url: "https://github.com/example/pull/1#discussion_r1",
      },
    });
    await setThreadInclusion(REVIEW_ID, held.id, false, { role: "human" });

    const view = await submitReview("p", REVIEW_ID, { destination: "idea" });
    expect(view.submissions[0]).toMatchObject({ threadIds: [taken.id] });

    const comments = readComments(REVIEW_ID);
    expect(comments.threads.find((thread) => thread.rootId === taken.id)?.state).toBe(
      "resolved",
    );
    for (const threadId of [held.id, mirrored.id]) {
      expect(comments.threads.find((thread) => thread.rootId === threadId)).toMatchObject({
        state: "open",
        included: false,
      });
    }
  });
});
