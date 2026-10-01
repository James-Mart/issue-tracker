import { searchHits } from "../lib/review-diff-search";
import {
  REVIEW_SEARCH_CURRENT_ATTR,
  REVIEW_SEARCH_MATCH_ATTR,
  reviewSearchCurrentStyle,
  reviewSearchMatchStyle,
} from "../lib/review-diff-search-mark";

const currentMarkProps = {
  [REVIEW_SEARCH_CURRENT_ATTR]: "true",
  "data-testid": "review-search-current",
  style: reviewSearchCurrentStyle,
};

const matchMarkProps = {
  [REVIEW_SEARCH_MATCH_ATTR]: "true",
  "data-testid": "review-search-match",
  style: reviewSearchMatchStyle,
};

/** Path text with every hit marked; the `occurrence`th hit is the current one. */
export function MarkedPathText({
  text,
  needle,
  occurrence,
}: {
  text: string;
  needle: string;
  occurrence: number | undefined;
}) {
  if (needle === "") return <>{text}</>;
  const hits = searchHits(text, needle, occurrence);
  if (occurrence !== undefined && !hits.some((hit) => hit.current)) {
    throw new Error(`diff search: path mark ${occurrence} is missing from ${text}`);
  }
  const pieces = [];
  let cursor = 0;
  for (const hit of hits) {
    pieces.push(text.slice(cursor, hit.start));
    pieces.push(
      <span key={hit.start} {...(hit.current ? currentMarkProps : matchMarkProps)}>
        {text.slice(hit.start, hit.end)}
      </span>,
    );
    cursor = hit.end;
  }
  pieces.push(text.slice(cursor));
  return <>{pieces}</>;
}
