export type ReviewDiffPane = "files" | "code";

/**
 * `?pane=` is `files` or `code`. Anything else, including a missing param,
 * is Code: the address has not named a choice.
 */
export function reviewDiffPaneFromSearch(params: URLSearchParams): ReviewDiffPane {
  const raw = params.get("pane");
  if (raw === "files" || raw === "code") return raw;
  return "code";
}

/** Record the phone pane. Other search params stay, so a commit change keeps it. */
export function writeReviewDiffPane(
  params: URLSearchParams,
  pane: ReviewDiffPane,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("pane", pane);
  return next;
}
