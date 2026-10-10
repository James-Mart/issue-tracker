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

  it("keeps a thread with the submission that still claims it", () => {
    for (const status of ["tasking", "failed", "incomplete"] as const) {
      expect(isSubmittable(thread(), [claim(status)])).toBe(false);
    }
    expect(isSubmittable(thread(), [claim("done"), claim("failed")])).toBe(false);
  });
});
