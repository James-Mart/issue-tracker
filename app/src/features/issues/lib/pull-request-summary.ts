import type { PrFacts } from "@server/services/delivery";
import { mergeControlFor } from "./merge-control";

export type PullRequestState = "Draft" | "Open" | "Merged" | "Closed";

export type PullRequestReview =
  | "Approved"
  | "Changes requested"
  | "Awaiting review";

export type PullRequestBlocker =
  | "Conflicts"
  | "Checks failing"
  | "Behind base";

export type PullRequestMerge = "merge" | "auto";

export type PullRequestSummary = {
  number: number;
  url: string;
  state: PullRequestState;
  review: PullRequestReview;
  blocker?: PullRequestBlocker;
  merge?: PullRequestMerge;
};

function pullRequestState(facts: PrFacts, merged: boolean): PullRequestState {
  if (merged || facts.state === "merged") return "Merged";
  if (facts.state === "closed") return "Closed";
  if (facts.isDraft) return "Draft";
  return "Open";
}

function pullRequestReview(
  decision: PrFacts["reviewDecision"],
): PullRequestReview {
  if (decision === "approved") return "Approved";
  if (decision === "changes-requested") return "Changes requested";
  return "Awaiting review";
}

function pullRequestBlocker(facts: PrFacts): PullRequestBlocker | undefined {
  if (facts.mergeable === "conflicting") return "Conflicts";
  if (facts.checks.state === "failure") return "Checks failing";
  if (facts.mergeStateStatus.toUpperCase() === "BEHIND") return "Behind base";
  return undefined;
}

function pullRequestMerge(
  facts: PrFacts,
  state: PullRequestState,
): PullRequestMerge | undefined {
  if (state !== "Open") return undefined;
  // GitHub has not finished computing mergeability; the panel refetches
  // instead of offering merge while this is unknown.
  if (facts.mergeable === "unknown") return undefined;
  const control = mergeControlFor(facts);
  if (control.mode === "unavailable") return undefined;
  return control.mode;
}

/** One-line pull request facts for the fixed-panel row. */
export function pullRequestSummary(
  facts: PrFacts,
  merged: boolean,
): PullRequestSummary {
  const state = pullRequestState(facts, merged);
  const summary: PullRequestSummary = {
    number: facts.number,
    url: facts.url,
    state,
    review: pullRequestReview(facts.reviewDecision),
  };
  if (state === "Open") {
    const blocker = pullRequestBlocker(facts);
    if (blocker) summary.blocker = blocker;
  }
  const merge = pullRequestMerge(facts, state);
  if (merge) summary.merge = merge;
  return summary;
}
