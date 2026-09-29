import { nthIndex } from "../lib/review-diff-search";
import {
  REVIEW_SEARCH_CURRENT_ATTR,
  reviewSearchCurrentStyle,
} from "../lib/review-diff-search-mark";

export function MarkedPathText({
  text,
  needle,
  occurrence,
}: {
  text: string;
  needle: string;
  occurrence: number | undefined;
}) {
  if (occurrence === undefined || needle === "") return <>{text}</>;
  const start = nthIndex(text, needle, occurrence);
  if (start < 0) {
    throw new Error(`diff search: path mark ${occurrence} is missing from ${text}`);
  }
  const end = start + needle.length;
  return (
    <>
      {text.slice(0, start)}
      <span
        {...{ [REVIEW_SEARCH_CURRENT_ATTR]: "true" }}
        data-testid="review-search-current"
        style={reviewSearchCurrentStyle}
      >
        {text.slice(start, end)}
      </span>
      {text.slice(end)}
    </>
  );
}
