import type { DerivedState, Issue } from "../schemas.js";

/**
 * True when an issue is complete for progress and open-root checks:
 * task done, story merged (derived status or the stored flag), epic done.
 */
export function isIssueComplete(
  issue: Issue,
  state: DerivedState | undefined,
): boolean {
  if (issue.kind === "task") return issue.status === "done";
  if (issue.kind === "story") {
    return state?.storyStatus === "merged" || issue.merged === true;
  }
  if (issue.kind === "epic") return state?.epicStatus === "done";
  return false;
}
