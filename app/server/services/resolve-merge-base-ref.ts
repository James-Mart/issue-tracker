import { existsSync } from "fs";
import { getOriginRemoteUrl } from "./git-read.js";
import { runGitWrite } from "./git-write.js";
import { IssueError } from "./errors.js";
import { list } from "./issues.js";
import {
  BEHIND_MERGE_BASE_NO_BRANCH_ERROR,
  BEHIND_MERGE_BASE_NO_MERGE_BASE_ERROR,
  BEHIND_MERGE_BASE_NO_WORKTREE_ERROR,
} from "./merge-base-task.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { projectContaining } from "./subtree.js";

const REMOTE_REF_NOT_FOUND = "couldn't find remote ref";

export async function resolveMergeBaseRef(
  cwd: string,
  mergeBase: string,
): Promise<string> {
  const originUrl = await getOriginRemoteUrl(cwd);
  if (originUrl === null) {
    return mergeBase;
  }

  try {
    await runGitWrite(["fetch", "origin", mergeBase], cwd);
    return `origin/${mergeBase}`;
  } catch (err) {
    if (
      err instanceof IssueError &&
      err.code === "git-failed" &&
      err.message.includes(REMOTE_REF_NOT_FOUND)
    ) {
      return mergeBase;
    }
    throw err;
  }
}

/** Derived on read from the Story worktree. Not stored. */
export async function storyMergeBaseRef(storyId: string): Promise<string> {
  const { issues, derived } = list();
  const detail = issues.find((issue) => issue.id === storyId);
  if (!detail || detail.kind !== "story") {
    throw new IssueError("not_found", `story "${storyId}" does not exist`);
  }
  if (!detail.branchName) {
    throw new IssueError("validation", BEHIND_MERGE_BASE_NO_BRANCH_ERROR(storyId));
  }
  const mergeBase = derived[storyId]?.mergeBase;
  if (!mergeBase) {
    throw new IssueError(
      "validation",
      BEHIND_MERGE_BASE_NO_MERGE_BASE_ERROR(storyId),
    );
  }
  const worktree = detail.worktreePath;
  if (!worktree || !existsSync(worktree)) {
    throw new IssueError(
      "validation",
      BEHIND_MERGE_BASE_NO_WORKTREE_ERROR(storyId),
    );
  }
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const projectId = projectContaining(detail, byId);
  if (!projectId) {
    throw new IssueError("not_found", `no project contains story "${storyId}"`);
  }
  const workspace = requireProjectWorkspace(projectId);
  return resolveMergeBaseRef(workspace, mergeBase);
}
