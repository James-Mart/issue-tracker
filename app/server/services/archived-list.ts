import type { IssuesResponse } from "../schemas.js";
import { IssueError } from "./errors.js";
import { isArchived } from "./archived-visibility.js";

/** `GET /api/issues?archived=` values. Omitted stays the current full list. */
export type ArchivedListQuery = "include" | "only";

export function parseArchivedListQuery(
  raw: unknown,
): ArchivedListQuery | undefined {
  if (raw === undefined) return undefined;
  if (raw === "include" || raw === "only") return raw;
  throw new IssueError("validation", "archived must be include or only");
}

/**
 * `include` is the current full list (live and archived). `only` is archived
 * issues. The no-flag list stays that full payload until a later task drops
 * archived issues from the default.
 */
export function applyArchivedListQuery(
  response: IssuesResponse,
  archived: ArchivedListQuery | undefined,
): IssuesResponse {
  if (archived !== "only") return response;
  const issues = response.issues.filter((issue) => isArchived(issue));
  const ids = new Set(issues.map((issue) => issue.id));
  const derived: IssuesResponse["derived"] = {};
  for (const issue of issues) {
    const state = response.derived[issue.id];
    if (state) derived[issue.id] = state;
  }
  return {
    issues,
    derived,
    problems: response.problems.filter((problem) => ids.has(problem.id)),
  };
}
