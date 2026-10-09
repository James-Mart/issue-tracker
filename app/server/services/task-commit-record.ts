import { existsSync } from "fs";
import type { Issue } from "../schemas.js";
import { appendTaskCommit, taskHeadCommit } from "./commit-sha.js";
import { runGit } from "./git-read.js";
import { projectContaining } from "./subtree.js";

type Task = Extract<Issue, { kind: "task" }>;

function gitDirFor(task: Task, issues: Issue[]): string | undefined {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const story = byId.get(task.partOf);
  if (story?.kind === "story" && story.worktreePath && existsSync(story.worktreePath)) {
    return story.worktreePath;
  }
  const projectId = projectContaining(task, byId);
  const project = projectId ? byId.get(projectId) : undefined;
  if (project?.kind === "project" && project.workspace && existsSync(project.workspace)) {
    return project.workspace;
  }
  return undefined;
}

async function parentsOf(sha: string, cwd: string): Promise<string | undefined> {
  try {
    return (await runGit(["log", "-1", "--format=%P", sha, "--"], cwd)).trim();
  } catch {
    return undefined;
  }
}

/**
 * The Task's commit series with `sha` recorded. When `sha` has the same
 * parents as the current head, it is an amend of that head and replaces it;
 * otherwise `sha` is appended. Falls back to appending when git cannot
 * read either commit.
 */
export async function recordTaskCommit(
  task: Task,
  sha: string,
  issues: Issue[],
): Promise<string[]> {
  const appended = appendTaskCommit(task, sha);
  const head = taskHeadCommit(task);
  if (!head) return appended;
  const cwd = gitDirFor(task, issues);
  if (!cwd) return appended;
  const [headParents, shaParents] = await Promise.all([
    parentsOf(head, cwd),
    parentsOf(sha, cwd),
  ]);
  if (!headParents || headParents !== shaParents) return appended;
  return [...task.commits.slice(0, -1), sha];
}
