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

  it("returns auto when pending checks are the only obstacle", () => {
    expect(
      mergeControlFor(
        prFacts({
          mergeStateStatus: "BLOCKED",
          checks: { state: "pending", failing: 0, pending: 2, total: 3 },
        }),
      ),
    ).toEqual({ mode: "auto", headRefOid: "abc123" });
  });

  it("is unavailable for a draft", () => {
    expect(
      mergeControlFor(
        prFacts({ isDraft: true, mergeStateStatus: "DRAFT", reviewDecision: null }),
      ),
    ).toEqual({
      mode: "unavailable",
      reason:
        "This pull request is a draft and must be marked ready on GitHub.",
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

  it("is unavailable when review is required", () => {
    expect(
      mergeControlFor(prFacts({ reviewDecision: "review-required" })),
    ).toMatchObject({
      mode: "unavailable",
      reason: "Review is required before this pull request can be merged.",
    });
  });

  it("is unavailable when changes are requested", () => {
    expect(
      mergeControlFor(prFacts({ reviewDecision: "changes-requested" })),
    ).toMatchObject({
      mode: "unavailable",
      reason: "Changes have been requested on this pull request.",
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

  it("is unavailable when a protection rule blocks", () => {
    expect(
      mergeControlFor(
        prFacts({
          mergeStateStatus: "BLOCKED",
          checks: { state: "success", failing: 0, pending: 0, total: 1 },
        }),
      ),
    ).toMatchObject({
      mode: "unavailable",
      reason: "Blocked by a repository protection rule.",
    });
  });

  it("is unavailable when the PR is behind its base", () => {
    expect(
      mergeControlFor(prFacts({ mergeStateStatus: "BEHIND" })),
    ).toMatchObject({
      mode: "unavailable",
      reason: "This pull request is behind its base branch.",
    });
  });

  it("returns merge when mergeability is still unknown and no gate fired", () => {
    expect(
      mergeControlFor(
        prFacts({ mergeable: "unknown", mergeStateStatus: "UNKNOWN" }),
      ),
    ).toEqual({ mode: "merge", headRefOid: "abc123" });
  });
});
