import { IssueError } from "./errors.js";
import { readIssueOrThrow } from "./issues.js";

/** Project id, or not_found when the id is missing or not a project. */
export function requireProject(projectId: string): string {
  const issue = readIssueOrThrow(projectId);
  if (issue.kind !== "project") {
    throw new IssueError("not_found", `unknown project "${projectId}"`);
  }
  return issue.id;
}
