import { describe, expect, it } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";
import {
  REVIEW_ID,
  seedReviewTasking as seed,
  useReviewTaskingStore,
  writeReviewSubmissions,
} from "./review-tasking.test-fixtures.js";

function stubSessions(): AgentSessions {
  return { getActiveRun: () => undefined } as unknown as AgentSessions;
}

async function load() {
  const tasking = await import("./review-tasking.js");
  const threads = await import("./thread-events.js");
  const issues = await import("./issues.js");
  return { ...tasking, ...threads, ...issues };
}

describe("retryOpenReviewSubmissions", () => {
  useReviewTaskingStore("issue-tracker-retry-open-");

  it("returns every incomplete and failed submission to tasking", async () => {
    seed();
    writeReviewSubmissions([
      {
        id: "sub-open",
        at: "2026-07-09T15:00:00.000Z",
        status: "incomplete",
        threadIds: ["thread-open"],
      },
      {
        id: "sub-failed",
        at: "2026-07-09T16:00:00.000Z",
        status: "failed",
        threadIds: ["thread-failed"],
        error: "tasker exploded",
      },
    ]);
    const { retryOpenReviewSubmissions } = await load();
    const view = await retryOpenReviewSubmissions("p", REVIEW_ID, {}, stubSessions());
    expect(view.submissions.map((item) => ({ id: item.id, status: item.status }))).toEqual([
      { id: "sub-open", status: "tasking" },
      { id: "sub-failed", status: "tasking" },
    ]);
    expect(view.submissions[1]).not.toHaveProperty("error");
  });

  it("finishes a submission whose threads are already handled and retries the rest", async () => {
    seed();
    const { retryOpenReviewSubmissions, appendComment, appendThreadEvent } = await load();
    const handled = await appendComment("s", { role: "human", body: "Handled" });
    const open = await appendComment("s", { role: "human", body: "Still open" });
    await appendThreadEvent("s", handled.id, { event: "resolved", by: { role: "human" } });
    writeReviewSubmissions([
      {
        id: "sub-handled",
        at: "2026-07-09T15:00:00.000Z",
        status: "incomplete",
        threadIds: [handled.id],
      },
      {
        id: "sub-open",
        at: "2026-07-09T16:00:00.000Z",
        status: "failed",
        threadIds: [open.id],
        error: "tasker exploded",
      },
    ]);
    const view = await retryOpenReviewSubmissions("p", REVIEW_ID, {}, stubSessions());
    expect(view.submissions.map((item) => ({ id: item.id, status: item.status }))).toEqual([
      { id: "sub-handled", status: "done" },
      { id: "sub-open", status: "tasking" },
    ]);
  });

  it("refuses when a submission is already tasking or none can be retried", async () => {
    seed();
    const { retryOpenReviewSubmissions, NO_RETRYABLE_SUBMISSION_ERROR, SUBMISSION_TASKING_ERROR } =
      await load();
    writeReviewSubmissions([
      {
        id: "sub-done",
        at: "2026-07-09T15:00:00.000Z",
        status: "done",
        threadIds: ["thread-done"],
        taskIds: ["task-done"],
      },
    ]);
    await expect(
      retryOpenReviewSubmissions("p", REVIEW_ID, {}, stubSessions()),
    ).rejects.toThrow(NO_RETRYABLE_SUBMISSION_ERROR);

    writeReviewSubmissions([
      {
        id: "sub-run",
        at: "2026-07-09T15:00:00.000Z",
        status: "tasking",
        threadIds: ["thread-run"],
      },
      {
        id: "sub-open",
        at: "2026-07-09T16:00:00.000Z",
        status: "incomplete",
        threadIds: ["thread-open"],
      },
    ]);
    await expect(
      retryOpenReviewSubmissions("p", REVIEW_ID, {}, stubSessions()),
    ).rejects.toThrow(SUBMISSION_TASKING_ERROR);
  });

  it("refuses on a merged Story", async () => {
    seed({ merged: true });
    writeReviewSubmissions([
      {
        id: "sub-open",
        at: "2026-07-09T15:00:00.000Z",
        status: "incomplete",
        threadIds: ["thread-open"],
      },
    ]);
    const { retryOpenReviewSubmissions, mergedStoryTaskingError } = await load();
    await expect(
      retryOpenReviewSubmissions("p", REVIEW_ID, {}, stubSessions()),
    ).rejects.toThrow(mergedStoryTaskingError("s"));
  });
});
