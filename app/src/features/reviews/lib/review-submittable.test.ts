import { describe, expect, it } from "vitest";
import {
  isSubmittable,
  type SubmissionClaim,
  type SubmittableThread,
} from "./review-submittable";

function thread(overrides: Partial<SubmittableThread> = {}): SubmittableThread {
  return {
    rootId: "thread-1",
    kind: "review",
    state: "open",
    ...overrides,
  };
}

function claim(
  status: SubmissionClaim["status"],
  threadIds: string[] = ["thread-1"],
): SubmissionClaim {
  return { status, threadIds };
}

describe("isSubmittable", () => {
  it("carries an open unlinked review thread no submission has claimed", () => {
    expect(isSubmittable(thread(), [])).toBe(true);
    expect(isSubmittable(thread(), [claim("done", ["other"])])).toBe(true);
  });

  it("skips threads that are not an open unlinked review", () => {
    expect(isSubmittable(thread({ kind: "question" }), [])).toBe(false);
    expect(isSubmittable(thread({ state: "resolved" }), [])).toBe(false);
    expect(isSubmittable(thread({ state: "dismissed" }), [])).toBe(false);
    expect(isSubmittable(thread({ linkedTaskId: "task-1" }), [])).toBe(false);
  });

  it("keeps a thread with the submission that still claims it", () => {
    for (const status of ["tasking", "failed", "incomplete"] as const) {
      expect(isSubmittable(thread(), [claim(status)])).toBe(false);
    }
    expect(isSubmittable(thread(), [claim("done"), claim("failed")])).toBe(false);
  });

  it("releases a done submission's thread once it is open again", () => {
    expect(isSubmittable(thread(), [claim("done")])).toBe(true);
    expect(isSubmittable(thread({ state: "resolved" }), [claim("done")])).toBe(false);
    expect(isSubmittable(thread({ linkedTaskId: "task-1" }), [claim("done")])).toBe(false);
  });
});
