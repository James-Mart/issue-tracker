import { describe, expect, it } from "vitest";
import type { ReviewSubmission } from "@server/schemas";
import {
  MERGED_STORY_SUBMIT_REASON,
  REVIEW_SUBMISSION_POLL_MS,
  acknowledgedSubmissions,
  conversationTimelineItems,
  reviewSubmitHeader,
  reviewSubmittedLabel,
  submissionPollInterval,
  submitReviewDialogDetail,
  taskingLabel,
} from "./review-submission-ui";

function submission(
  status: ReviewSubmission["status"],
  overrides: Partial<ReviewSubmission> = {},
): ReviewSubmission {
  const base = {
    id: "sub-1",
    at: "2026-09-29T12:00:00.000Z",
    threadIds: ["thread-a", "thread-b"],
    conversationId: "conv-1",
    ...overrides,
    status,
  };
  if (status === "done") {
    return { ...base, status, taskIds: ["task-a", "task-b"] };
  }
  if (status === "failed") {
    const error =
      "error" in overrides && typeof overrides.error === "string"
        ? overrides.error
        : "Tasking agent stopped.";
    return { ...base, status, error };
  }
  return { ...base, status };
}

describe("reviewSubmitHeader", () => {
  it("disables submit at zero ready threads", () => {
    expect(
      reviewSubmitHeader({ merged: false, readyCount: 0, submissions: [] }),
    ).toEqual({
      mode: "submit",
      label: "Submit review (0)",
      disabled: true,
      readyCount: 0,
    });
  });

  it("enables submit with the ready count", () => {
    const header = reviewSubmitHeader({ merged: false, readyCount: 2, submissions: [] });
    expect(header.mode).toBe("submit");
    if (header.mode !== "submit") return;
    expect(header.label).toBe("Submit review (2)");
    expect(header.disabled).toBe(false);
  });

  it("disables submit on a merged Story and names why", () => {
    const header = reviewSubmitHeader({
      merged: true,
      readyCount: 3,
      submissions: [],
    });
    expect(header).toMatchObject({
      mode: "submit",
      disabled: true,
      label: "Submit review (3)",
      reason: MERGED_STORY_SUBMIT_REASON,
    });
  });

  it("shows tasking in place of submit", () => {
    const header = reviewSubmitHeader({
      merged: false,
      readyCount: 0,
      submissions: [submission("tasking", { conversationId: undefined })],
    });
    expect(header).toEqual({
      mode: "tasking",
      label: taskingLabel(2),
    });
    expect(header).toMatchObject({ label: "Tasking 2 threads…" });
  });

  it("shows the latest failure and blocks retry once the Story is merged", () => {
    const older = submission("failed", {
      id: "older",
      at: "2026-09-29T11:00:00.000Z",
      error: "older",
    });
    const newer = submission("failed", {
      id: "newer",
      at: "2026-09-29T13:00:00.000Z",
      error: "newer",
    });
    expect(
      reviewSubmitHeader({
        merged: false,
        readyCount: 1,
        submissions: [older, newer],
      }),
    ).toMatchObject({
      mode: "failed",
      submissionId: "newer",
      error: "newer",
      retryDisabled: false,
    });
    expect(
      reviewSubmitHeader({
        merged: true,
        readyCount: 1,
        submissions: [newer],
      }),
    ).toMatchObject({
      retryDisabled: true,
      reason: MERGED_STORY_SUBMIT_REASON,
    });
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

  it("shows a retry as tasking until the request settles", () => {
    const failed = submission("failed");
    const marked = acknowledgedSubmissions([failed], undefined, failed.id);
    expect(marked[0]).toMatchObject({
      id: failed.id,
      status: "tasking",
      threadIds: failed.threadIds,
    });
    expect(marked[0]).not.toHaveProperty("error");
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
