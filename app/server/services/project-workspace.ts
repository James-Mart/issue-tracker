import { IssueError } from "./errors.js";
import { readIssueOrThrow } from "./issues.js";
import { readWorkspaceFile, type WorkspaceFileBytes } from "./workspace.js";

/** Resolve a Project's workspace path or throw a validation error. */
export function requireProjectWorkspace(projectId: string): string {
  const issue = readIssueOrThrow(projectId);
  if (issue.kind !== "project") {
    throw new IssueError("validation", `issue "${projectId}" is not a project`);
  }
  if (!issue.workspace) {
    throw new IssueError("validation", "Project workspace is not set");
  }
  return issue.workspace;
}

export function getWorkspaceFile(
  projectId: string,
  relativePath: string,
): WorkspaceFileBytes {
  return readWorkspaceFile(requireProjectWorkspace(projectId), relativePath);
}
