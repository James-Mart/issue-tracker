/** A review whose diff and tip come from the pull request, with no Story source. */
export function isPullRequestOnlyReview(review: {
  story?: string;
  pr?: unknown;
}): boolean {
  return review.story === undefined && review.pr !== undefined;
}

/** Head of a pull-request-only review. A Story source does not use it as the tip. */
export function pullRequestHeadSha(
  storyId: string,
  review: { pr?: { headSha: string } },
): string | undefined {
  if (storyId) return undefined;
  return review.pr?.headSha;
}
