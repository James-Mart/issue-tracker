import type { PrFacts } from "@server/services/delivery";

export type MergeControl =
  | { mode: "merge"; headRefOid: string }
  | { mode: "auto"; headRefOid: string }
  | { mode: "unavailable"; reason: string };

/** Decide whether the PR panel may merge, auto-merge, or only explain a block. */
export function mergeControlFor(facts: PrFacts): MergeControl {
  if (facts.isDraft) {
    return {
      mode: "unavailable",
      reason:
        "This pull request is a draft and must be marked ready on GitHub.",
    };
  }
  if (facts.mergeable === "conflicting") {
    return {
      mode: "unavailable",
      reason: "This pull request has merge conflicts.",
    };
  }
  if (facts.reviewDecision === "review-required") {
    return {
      mode: "unavailable",
      reason: "Review is required before this pull request can be merged.",
    };
  }
  if (facts.reviewDecision === "changes-requested") {
    return {
      mode: "unavailable",
      reason: "Changes have been requested on this pull request.",
    };
  }
  if (facts.checks.state === "failure") {
    return {
      mode: "unavailable",
      reason: "Checks are failing on this pull request.",
    };
  }
  if (facts.checks.state === "pending") {
    return { mode: "auto", headRefOid: facts.headRefOid };
  }
  const status = facts.mergeStateStatus.toUpperCase();
  if (status === "BLOCKED") {
    return {
      mode: "unavailable",
      reason: "Blocked by a repository protection rule.",
    };
  }
  if (status === "BEHIND") {
    return {
      mode: "unavailable",
      reason: "This pull request is behind its base branch.",
    };
  }
  if (facts.mergeable === "unknown") {
    return {
      mode: "unavailable",
      reason: "Mergeability is still unknown.",
    };
  }
  return { mode: "merge", headRefOid: facts.headRefOid };
}
