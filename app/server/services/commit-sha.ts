import type { IssuePatch } from "../schemas.js";
import { IssueError } from "./errors.js";

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

export function validateFullCommitSha(sha: string): void {
  if (!FULL_COMMIT_SHA.test(sha)) {
    throw new IssueError(
      "validation",
      `invalid commit sha "${sha}" (expected full 40- or 64-character hex object name)`,
    );
  }
}

/** Head of a Task's commit series — the last element, or undefined when empty. */
export function taskHeadCommit(task: { commits: string[] }): string | undefined {
  return task.commits.at(-1);
}

export function appendTaskCommit(
  task: { commits: string[] },
  sha: string,
): string[] {
  validateFullCommitSha(sha);
  if (task.commits.includes(sha)) {
    throw new IssueError(
      "validation",
      `commit sha "${sha}" is already on this Task`,
    );
  }
  return [...task.commits, sha];
}

export function validateCommitsPatch(patch: IssuePatch): void {
  if (!("commits" in patch)) return;
  const { commits } = patch;
  if (commits === undefined) return;
  for (const sha of commits) {
    validateFullCommitSha(sha);
  }
}
