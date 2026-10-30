import { describe, expect, it } from "vitest";
import { foldTimelineRuns } from "./review-conversation-runs";

const SEP28 = "2026-09-28T12:00:00.000Z";
const SEP28_LATER = "2026-09-28T15:00:00.000Z";
const SEP29 = "2026-09-29T12:00:00.000Z";
const SEP30 = "2026-09-30T12:00:00.000Z";

function thread(
  id: string,
  at: string,
  state: "open" | "resolved" | "dismissed",
  kind: "review" | "question" = state === "dismissed" ? "question" : "review",
) {
  return { kind: "thread" as const, at, thread: { kind, state, root: { id } } };
}

function submitted(id: string, at: string) {
  return { kind: "submitted" as const, at, submission: { id } };
}

describe("foldTimelineRuns", () => {
  it("breaks a run at an open thread and at a submission", () => {
    const first = thread("a", SEP28, "resolved");
    const second = thread("b", SEP28_LATER, "dismissed");
    const open = thread("c", SEP29, "open");
    const question = thread("q", SEP29, "open", "question");
    const marker = submitted("sub", SEP29);
    const after = thread("d", SEP29, "resolved");
    const tailA = thread("e", SEP30, "resolved");
    const tailB = thread("f", SEP30, "dismissed");
    expect(
      foldTimelineRuns([first, second, open, after, marker, tailA, tailB, question]),
    ).toEqual([
      {
        kind: "run",
        threads: [first, second],
        resolvedCount: 1,
        dismissedCount: 1,
        firstAt: SEP28,
        lastAt: SEP28_LATER,
      },
      open,
      after,
      marker,
      {
        kind: "run",
        threads: [tailA, tailB],
        resolvedCount: 1,
        dismissedCount: 1,
        firstAt: SEP30,
        lastAt: SEP30,
      },
      question,
    ]);
  });
});
