import { IssueError } from "./errors.js";
import { readIssueOrThrow } from "./issues.js";
import { readWorkspaceFile, type WorkspaceFileBytes } from "./workspace.js";

export function getWorkspaceFile(
  projectId: string,
  relativePath: string,
): WorkspaceFileBytes {
  const issue = readIssueOrThrow(projectId);
  if (issue.kind !== "project") {
    throw new IssueError("validation", `issue "${projectId}" is not a project`);
  }
  if (!issue.workspace) {
    throw new IssueError("validation", "Project workspace is not set");
  }
  return readWorkspaceFile(issue.workspace, relativePath);
}
