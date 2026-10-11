import { describe, expect, it } from "vitest";
import { acknowledgedSubmissions, reviewSubmitHeader } from "./review-submission-ui";

describe("reviewSubmitHeader", () => {
  it("disables retry while another submission is tasking", () => {
    const header = reviewSubmitHeader({
      merged: false,
      readyCount: 0,
      submissions: [
        {
          id: "open",
          at: "2026-09-29T12:00:00.000Z",
          status: "incomplete",
          threadIds: ["thread-a", "thread-b"],
          conversationId: "conv-1",
          round: 1,
          openThreadIds: ["thread-a"],
        },
        {
          id: "run",
          at: "2026-09-29T12:00:00.000Z",
          status: "tasking",
          threadIds: ["thread-b", "thread-c"],
          conversationId: "conv-1",
          round: 2,
          openThreadIds: ["thread-b"],
        },
      ],
    });
    expect(header.submit).toBeUndefined();
    expect(header.taskingLabel).toBe("Tasking 2 threads…");
    expect(header.retry).toMatchObject({ submissionIds: ["open"], disabled: true });
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
});
