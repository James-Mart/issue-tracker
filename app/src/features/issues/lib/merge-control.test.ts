import { describe, expect, it } from "vitest";
import type { PrFacts } from "@server/services/delivery";
import { mergeControlFor } from "./merge-control";

function prFacts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    number: 12,
    url: "https://github.com/acme/widgets/pull/12",
    state: "open",
    isDraft: false,
    mergeable: "mergeable",
    mergeStateStatus: "CLEAN",
    reviewDecision: "approved",
    checks: { state: "success", failing: 0, pending: 0, total: 3 },
    commentCount: 0,
    comments: [],
    headRefOid: "abc123",
    baseRefName: "main",
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("mergeControlFor", () => {
  it("returns merge when the PR is ready", () => {
    expect(mergeControlFor(prFacts())).toEqual({
      mode: "merge",
      headRefOid: "abc123",
    });
  });

  it("is unavailable for conflicts", () => {
    expect(
      mergeControlFor(
        prFacts({ mergeable: "conflicting", mergeStateStatus: "DIRTY" }),
      ),
    ).toMatchObject({
      mode: "unavailable",
      reason: "This pull request has merge conflicts.",
    });
  });

  it("is unavailable when checks fail", () => {
    expect(
      mergeControlFor(
        prFacts({
          checks: { state: "failure", failing: 1, pending: 0, total: 2 },
        }),
      ),
    ).toMatchObject({
      mode: "unavailable",
      reason: "Checks are failing on this pull request.",
    });
  });
});
