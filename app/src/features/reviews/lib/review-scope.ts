import type { ReviewCommitSummary, ReviewView } from "@server/schemas";
import { shortSha } from "@/lib/utils/short-sha";
import type { ReviewWorkbenchTab } from "./workbench-tabs";

export const ALL_CHANGES_SCOPE = "all";

/** Optimistic Reviewed flags keyed by scope, then path. Shared across tabs. */
export type ReviewMarkOverrides = Record<string, Record<string, boolean>>;

/** Write the workbench tab and scope into the search params. Both stay explicit. */
export function writeReviewWorkbenchSearch(
  params: URLSearchParams,
  tab: ReviewWorkbenchTab,
  scope: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("tab", tab);
  next.set("scope", scope);
  return next;
}

/**
 * `?scope=` is `all` or one of this Story's commit shas.
 * Until the commit list has loaded, an unknown value is kept so a shared
 * link does not flash "All changes" and then jump. Once the list is known,
 * a sha that is not in it resolves to `all`.
 */
export function resolveReviewScope(
  raw: string | null,
  knownShas: readonly string[] | undefined,
): string {
  if (raw === null || raw.length === 0 || raw === ALL_CHANGES_SCOPE) {
    return ALL_CHANGES_SCOPE;
  }
  if (knownShas === undefined) return raw;
  return knownShas.includes(raw) ? raw : ALL_CHANGES_SCOPE;
}

/** "All changes", then each Story commit in the order the API returns (oldest first). */
export function reviewScopeSequence(commits: readonly { sha: string }[]): string[] {
  return [ALL_CHANGES_SCOPE, ...commits.map((commit) => commit.sha)];
}

export function adjacentReviewScope(
  sequence: readonly string[],
  scope: string,
  direction: -1 | 1,
): string | undefined {
  const index = sequence.indexOf(scope);
  if (index < 0) return undefined;
  return sequence[index + direction];
}

export function reviewScopeLabel(
  scope: string,
  commits: readonly ReviewCommitSummary[],
): string {
  if (scope === ALL_CHANGES_SCOPE) return "All changes";
  const commit = commits.find((entry) => entry.sha === scope);
  const sha = shortSha(scope);
  return commit ? `Commit ${sha} — ${commit.subject}` : `Commit ${sha}`;
}

/**
 * Reviewed count for one commit. Reads that commit's marks only, so a
 * commit-scoped mark cannot change whole-review progress.
 */
export function commitReviewedCount(
  review: ReviewView,
  sha: string,
  overrides: Record<string, boolean> | undefined,
): { reviewed: number; total: number } {
  const base = review.progress.commits[sha];
  if (!base) {
    throw new Error(`review progress has no commit scope "${sha}"`);
  }
  if (!overrides) return { reviewed: base.reviewed, total: base.total };
  const bucket = review.marks.commits[sha] ?? {};
  let reviewed = base.reviewed;
  for (const [path, want] of Object.entries(overrides)) {
    const server = path in bucket;
    if (want === server) continue;
    reviewed += want ? 1 : -1;
  }
  return { reviewed, total: base.total };
}
