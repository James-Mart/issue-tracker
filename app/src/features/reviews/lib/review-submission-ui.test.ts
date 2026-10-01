import { describe, expect, it } from "vitest";
import type { ReviewSubmission, ReviewSubmissionOpen, ReviewSubmissionView } from "@server/schemas";
import {
  MERGED_STORY_SUBMIT_REASON,
  REVIEW_SUBMISSION_POLL_MS,
  acknowledgedSubmissions,
  conversationTimelineItems,
  openThreadsHeadline,
  reviewSubmitHeader,
  reviewSubmittedLabel,
  submissionPollInterval,
  submitReviewDialogDetail,
  taskingLabel,
} from "./review-submission-ui";

function submission(
  status: ReviewSubmission["status"],
  overrides: Partial<ReviewSubmission> & Partial<ReviewSubmissionOpen> = {},
): ReviewSubmissionView {
  const threadIds = overrides.threadIds ?? ["thread-a", "thread-b"];
  const identity = {
    id: overrides.id ?? "sub-1",
    at: overrides.at ?? "2026-09-29T12:00:00.000Z",
    threadIds,
    ...("conversationId" in overrides
      ? overrides.conversationId
        ? { conversationId: overrides.conversationId }
        : {}
      : { conversationId: "conv-1" }),
    ...(overrides.summaryCommentId
      ? { summaryCommentId: overrides.summaryCommentId }
      : {}),
  };
  if (status === "done") {
    return {
      ...identity,
      status,
      taskIds: overrides.taskIds ?? ["task-a", "task-b"],
    };
  }
  const open = {
    round: overrides.round ?? 1,
    openThreadIds: overrides.openThreadIds ?? [...threadIds],
  };
  const tasks = overrides.taskIds ? { taskIds: overrides.taskIds } : {};
  if (status === "failed") {
    const error =
      "error" in overrides && typeof overrides.error === "string"
        ? overrides.error
        : "Tasking agent stopped.";
    return { ...identity, ...open, ...tasks, status, error };
  }
  return { ...identity, ...open, ...tasks, status };
}

describe("reviewSubmitHeader", () => {
  it("disables submit at zero ready threads", () => {
    expect(
      reviewSubmitHeader({ merged: false, readyCount: 0, submissions: [] }),
    ).toEqual({
      submit: {
        label: "Submit review (0)",
        disabled: true,
        readyCount: 0,
      },
      failures: [],
      openRounds: [],
    });
  });

  it("enables submit with the ready count", () => {
    const header = reviewSubmitHeader({ merged: false, readyCount: 2, submissions: [] });
    expect(header.submit).toMatchObject({
      label: "Submit review (2)",
      disabled: false,
    });
    expect(header.taskingLabel).toBeUndefined();
    expect(header.retry).toBeUndefined();
  });

  it("disables submit on a merged Story and names why", () => {
    const header = reviewSubmitHeader({
      merged: true,
      readyCount: 3,
      submissions: [],
    });
    expect(header.submit).toMatchObject({
      disabled: true,
      label: "Submit review (3)",
      reason: MERGED_STORY_SUBMIT_REASON,
    });
  });

  it("shows tasking in place of submit", () => {
    const header = reviewSubmitHeader({
      merged: false,
      readyCount: 0,
      submissions: [
        submission("tasking", {
          conversationId: undefined,
          round: 1,
          openThreadIds: ["thread-a", "thread-b"],
        }),
      ],
    });
    expect(header.taskingLabel).toBe(taskingLabel(2));
    expect(header.submit).toBeUndefined();
    expect(header.openRounds).toEqual([
      { submissionId: "sub-1", round: 1, threadIds: ["thread-a", "thread-b"] },
    ]);
  });

  it("keeps every failed error and still offers submit", () => {
    const older = submission("failed", {
      id: "older",
      at: "2026-09-29T11:00:00.000Z",
      error: "older",
      round: 1,
      openThreadIds: ["thread-a"],
    });
    const newer = submission("failed", {
      id: "newer",
      at: "2026-09-29T13:00:00.000Z",
      error: "newer",
      round: 2,
      openThreadIds: ["thread-b"],
    });
    const header = reviewSubmitHeader({
      merged: false,
      readyCount: 1,
      submissions: [older, newer],
    });
    expect(header.submit).toMatchObject({ disabled: false, label: "Submit review (1)" });
    expect(header.failures).toEqual([
      { submissionId: "older", message: "older" },
      { submissionId: "newer", message: "newer" },
    ]);
    expect(header.retry).toEqual({
      submissionIds: ["older", "newer"],
      disabled: false,
    });
    expect(header.openRounds.map((round) => round.round)).toEqual([1, 2]);
    expect(openThreadsHeadline(2)).toBe("2 submitted threads still open");
  });

  it("blocks retry once the Story is merged", () => {
    const failed = submission("failed", { round: 1, openThreadIds: ["thread-a"] });
    expect(
      reviewSubmitHeader({
        merged: true,
        readyCount: 1,
        submissions: [failed],
      }),
    ).toMatchObject({
      submit: { disabled: true, reason: MERGED_STORY_SUBMIT_REASON },
      retry: { disabled: true, reason: MERGED_STORY_SUBMIT_REASON, submissionIds: ["sub-1"] },
    });
  });

  it("keeps submit beside an incomplete submission and does not call it a failure", () => {
    const incomplete = submission("incomplete", {
      id: "open",
      at: "2026-09-29T13:00:00.000Z",
      round: 2,
      openThreadIds: ["thread-a"],
    });
    const olderFailure = submission("failed", {
      id: "older",
      at: "2026-09-29T11:00:00.000Z",
      error: "older",
      round: 1,
      openThreadIds: ["thread-b"],
    });
    const header = reviewSubmitHeader({
      merged: false,
      readyCount: 1,
      submissions: [olderFailure, incomplete],
    });
    expect(header.submit).toMatchObject({ disabled: false, label: "Submit review (1)" });
    expect(header.failures).toEqual([{ submissionId: "older", message: "older" }]);
    expect(header.retry).toEqual({
      submissionIds: ["older", "open"],
      disabled: false,
    });
    expect(header.openRounds).toEqual([
      { submissionId: "older", round: 1, threadIds: ["thread-b"] },
      { submissionId: "open", round: 2, threadIds: ["thread-a"] },
    ]);
    expect(openThreadsHeadline(1)).toBe("1 submitted thread still open");
  });

  it("disables retry while another submission is tasking", () => {
    const header = reviewSubmitHeader({
      merged: false,
      readyCount: 0,
      submissions: [
        submission("incomplete", { id: "open", round: 1, openThreadIds: ["thread-a"] }),
        submission("tasking", {
          id: "run",
          threadIds: ["thread-b", "thread-c"],
          round: 2,
          openThreadIds: ["thread-b"],
        }),
      ],
    });
    expect(header.submit).toBeUndefined();
    expect(header.taskingLabel).toBe("Tasking 2 threads…");
    expect(header.retry).toMatchObject({ submissionIds: ["open"], disabled: true });
  });
});

describe("submission copy", () => {
  it("pluralizes the dialog and the timeline event", () => {
    expect(submitReviewDialogDetail(1)).toBe(
      "Turn 1 unresolved thread into Tasks. An optional summary comment is posted to the Conversation timeline.",
    );
    expect(taskingLabel(1)).toBe("Tasking 1 thread…");
    expect(reviewSubmittedLabel(3, 2)).toBe("Review submitted — 3 threads → Tasks");
    expect(reviewSubmittedLabel(1, 1)).toBe("Review submitted — 1 thread → Task");
  });
});

describe("acknowledgedSubmissions", () => {
  it("marks a submit as tasking before the server record exists", () => {
    const marked = acknowledgedSubmissions([], ["thread-a"], undefined);
    expect(marked).toMatchObject([
      { status: "tasking", threadIds: ["thread-a"] },
    ]);
    expect(marked[0]).not.toHaveProperty("conversationId");
  });

  it("keeps the server tasking record once it arrives", () => {
    const server = submission("tasking", { conversationId: undefined });
    expect(acknowledgedSubmissions([server], ["thread-a"], undefined)).toEqual([server]);
  });

  it("shows every retried submission as tasking until the request settles", () => {
    const failed = submission("failed", {
      id: "bad",
      round: 1,
      openThreadIds: ["thread-a"],
    });
    const incomplete = submission("incomplete", {
      id: "open",
      round: 2,
      openThreadIds: ["thread-b"],
    });
    const marked = acknowledgedSubmissions([failed, incomplete], undefined, ["bad", "open"]);
    expect(marked.map((item) => item.status)).toEqual(["tasking", "tasking"]);
    expect(marked[0]).not.toHaveProperty("error");
    expect(marked[0]).toMatchObject({
      id: "bad",
      threadIds: failed.threadIds,
      round: 1,
      openThreadIds: ["thread-a"],
    });
    expect(marked[1]).toMatchObject({ round: 2, openThreadIds: ["thread-b"] });
  });
});

describe("submissionPollInterval", () => {
  it("polls only while a submission is tasking", () => {
    expect(submissionPollInterval(undefined)).toBe(false);
    expect(submissionPollInterval([])).toBe(false);
    expect(submissionPollInterval([{ status: "done" }])).toBe(false);
    expect(submissionPollInterval([{ status: "tasking" }])).toBe(REVIEW_SUBMISSION_POLL_MS);
  });
});

describe("conversationTimelineItems", () => {
  it("places a finished submission by time and skips tasking and failed", () => {
    const threads = [
      { root: { at: "2026-09-29T10:00:00.000Z", id: "early" } },
      { root: { at: "2026-09-29T14:00:00.000Z", id: "late" } },
    ];
    const items = conversationTimelineItems(threads, [
      submission("tasking", { id: "run", at: "2026-09-29T11:00:00.000Z" }),
      submission("incomplete", { id: "open", at: "2026-09-29T11:15:00.000Z" }),
      submission("failed", { id: "bad", at: "2026-09-29T11:30:00.000Z" }),
      submission("done", { id: "ok", at: "2026-09-29T12:00:00.000Z" }),
    ]);
    expect(items.map((item) => (item.kind === "thread" ? item.thread.root.id : item.submission.id))).toEqual([
      "early",
      "ok",
      "late",
    ]);
  });
});
