import { useMemo, useState } from "react";
import type { ReviewDiffFile } from "@server/schemas";
import {
  collectDiffSearchMatches,
  type DiffSearchMatch,
  type SearchableDiff,
} from "../lib/review-diff-search";

export function useReviewDiffSearch(
  files: ReviewDiffFile[],
  diffs: Map<string, SearchableDiff>,
  scope: string,
) {
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [scopeKey, setScopeKey] = useState(scope);
  if (scope !== scopeKey) {
    setScopeKey(scope);
    setMatchIndex(0);
  }

  const matches = useMemo(
    () => collectDiffSearchMatches(files, diffs, query),
    [diffs, files, query],
  );
  const needle = query.trim();
  const currentIndex = matches.length === 0 ? 0 : Math.min(matchIndex, matches.length - 1);
  const current: DiffSearchMatch | undefined = matches[currentIndex];

  const matchKey = current ? `${scope}:${needle}:${current.index}` : "";
  const [trackedMatchKey, setTrackedMatchKey] = useState(matchKey);
  const [scrollNonce, setScrollNonce] = useState(0);
  if (matchKey !== trackedMatchKey) {
    setTrackedMatchKey(matchKey);
    setScrollNonce((nonce) => nonce + 1);
  }

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const base = Math.min(matchIndex, matches.length - 1);
    setMatchIndex((base + delta + matches.length) % matches.length);
  };

  return {
    query,
    needle,
    matches,
    current,
    currentIndex,
    scrollNonce,
    filtering: needle !== "",
    onQueryChange: (value: string) => {
      setQuery(value);
      setMatchIndex(0);
    },
    step,
    goToPath(path: string) {
      const at = matches.findIndex((match) => match.path === path);
      if (at >= 0) setMatchIndex(at);
    },
  };
}
