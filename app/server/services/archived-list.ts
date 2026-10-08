import type { IssuesResponse } from "../schemas.js";
import { IssueError } from "./errors.js";
import { isArchived, visibleIssues } from "./archived-visibility.js";

/** `GET /api/issues?archived=` values. Omitted is non-archived issues only. */
export type ArchivedListQuery = "include" | "only";

export function parseArchivedListQuery(
  raw: unknown,
): ArchivedListQuery | undefined {
  if (raw === undefined) return undefined;
  if (raw === "include" || raw === "only") return raw;
  throw new IssueError("validation", "archived must be include or only");
}

function sliceIssuesResponse(
  response: IssuesResponse,
  issues: IssuesResponse["issues"],
): IssuesResponse {
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

/**
 * Omitted query: non-archived issues. `include` is live and archived. `only` is
 * archived issues.
 */
export function applyArchivedListQuery(
  response: IssuesResponse,
  archived: ArchivedListQuery | undefined,
): IssuesResponse {
  if (archived === "include") return response;
  if (archived === undefined) {
    if (!response.issues.some(isArchived)) return response;
    return sliceIssuesResponse(
      response,
      visibleIssues(response.issues, false),
    );
  }
  return sliceIssuesResponse(response, response.issues.filter(isArchived));
}
