import { describe, expect, it } from "vitest";
import {
  AT,
  REVIEW_ID,
  seedReviewTasking as seed,
  stubReviewTaskingSessions,
  useReviewTaskingStore,
  writeReviewSubmissions,
  writeReviewTaskingIssue,
} from "./review-tasking.test-fixtures.js";

async function load() {
  const tasking = await import("./review-tasking.js");
  const threads = await import("./thread-events.js");
  const issues = await import("./issues.js");
  const reviews = await import("./reviews.js");
  return { ...reviews, ...tasking, ...threads, ...issues };
}

async function linkTask(commentId: string, taskId: string, at: string): Promise<void> {
  const later = new Date(Date.parse(at) + 1000).toISOString();
  writeReviewTaskingIssue(taskId, {
    kind: "task",
    title: taskId,
    partOf: "s",
    status: "todo",
    order: 1,
    createdAt: later,
    updatedAt: later,
  });
  const { appendThreadEvent } = await load();
  await appendThreadEvent("s", commentId, {
    event: "linked",
    taskId,
    by: { role: "human" },
  });
}

describe("coordinator resume once per submission", () => {
  useReviewTaskingStore("issue-tracker-coordinator-resume-");

  it("does not bring the coordinator in again when the field is already set", async () => {
    seed();
    const prompts: string[] = [];
    const { appendComment, retryReviewSubmission } = await load();
    const handled = await appendComment("s", { role: "human", body: "Handled" });
    await linkTask(handled.id, "task-a", AT);
    writeReviewSubmissions([
      {
        id: "sub-done",
        at: AT,
        status: "incomplete",
        threadIds: [handled.id],
        coordinatorResumed: true,
      },
    ]);

    const view = await retryReviewSubmission(
      "p",
      REVIEW_ID,
      "sub-done",
      {},
      stubReviewTaskingSessions(prompts),
    );

    expect(view.submissions[0]).toMatchObject({
      status: "done",
      taskIds: ["task-a"],
      coordinatorResumed: true,
    });
    expect(prompts).toEqual([]);
  });

  it("brings the coordinator in once for each submission that finishes together", async () => {
    seed();
    const prompts: string[] = [];
    const { appendComment, retryOpenReviewSubmissions } = await load();
    const first = await appendComment("s", { role: "human", body: "First" });
    const second = await appendComment("s", { role: "human", body: "Second" });
    await linkTask(first.id, "task-a", AT);
    await linkTask(second.id, "task-b", AT);
    writeReviewSubmissions([
      {
        id: "sub-a",
        at: AT,
        status: "incomplete",
        threadIds: [first.id],
      },
      {
        id: "sub-b",
        at: AT,
        status: "failed",
        threadIds: [second.id],
        error: "tasker exploded",
      },
    ]);

    const view = await retryOpenReviewSubmissions(
      "p",
      REVIEW_ID,
      {},
      stubReviewTaskingSessions(prompts),
    );

    const { implementingResumePrompt, implementingSessionMessage } = await import(
      "./implementing-launch.js"
    );
    const resume = implementingResumePrompt();
    expect(view.submissions).toEqual([
      expect.objectContaining({
        id: "sub-a",
        status: "done",
        taskIds: ["task-a"],
        coordinatorResumed: true,
      }),
      expect.objectContaining({
        id: "sub-b",
        status: "done",
        taskIds: ["task-b"],
        coordinatorResumed: true,
      }),
    ]);
    expect(prompts).toEqual([
      `${implementingSessionMessage("e")}\n\n${resume}`,
      resume,
    ]);
  });
});
