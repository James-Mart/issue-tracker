import { describe, expect, it } from "vitest";
import type { PrFacts } from "@server/services/delivery";
import { pullRequestSummary } from "./pull-request-summary";

function prFacts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    number: 2041,
    url: "https://github.com/acme/widgets/pull/2041",
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

describe("pullRequestSummary", () => {
  it("prefers conflicts over failing checks and a behind base", () => {
    expect(
      pullRequestSummary(
        prFacts({
          mergeable: "conflicting",
          mergeStateStatus: "BEHIND",
          checks: { state: "failure", failing: 2, pending: 0, total: 4 },
        }),
        false,
      ).blocker,
    ).toBe("Conflicts");
  });
});
