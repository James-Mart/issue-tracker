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

export function validateCommitShaPatch(patch: IssuePatch): void {
  if (!("commitSha" in patch)) return;
  const { commitSha } = patch;
  if (commitSha !== null && commitSha !== undefined) {
    validateFullCommitSha(commitSha);
  }
}
