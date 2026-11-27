import type { Issue, IssuePatch } from "../schemas.js";
import { NON_CLEARABLE_MERGEABLE_KEYS } from "../fields.js";
import { assertStoryCanSetSourceIdea } from "../kind-fields.js";
import { IssueError } from "./errors.js";
import { mergeIssue } from "./merge.js";

export function validateNonClearablePatch(
  existing: Issue,
  patch: IssuePatch,
): void {
  for (const key of NON_CLEARABLE_MERGEABLE_KEYS) {
    if (key in patch && patch[key] === null) {
      if (key === "mergePolicy" && existing.kind !== "project") continue;
      throw new IssueError("validation", `${key} cannot be cleared`);
    }
  }
}

/** Refuse values for fields only the server writes; clearing them stays allowed. */
export function validateSystemWrittenPatch(patch: IssuePatch): void {
  for (const field of [
    "workQueuedAt",
    "workQueuePosition",
    "workParkedAt",
    "workResumeNote",
  ] as const) {
    const value = patch[field];
    if (value !== undefined && value !== null) {
      throw new IssueError("validation", `${field} is system-written`);
    }
  }
  if (patch.planQueuedAt !== undefined && patch.planQueuedAt !== null) {
    throw new IssueError(
      "validation",
      "planQueuedAt is system-written; clear it to dequeue",
    );
  }
  if (patch.bodyVersion !== undefined) {
    throw new IssueError("validation", "bodyVersion is system-written");
  }
  if (patch.concludedAt !== undefined) {
    throw new IssueError("validation", "concludedAt is system-written");
  }
  if (patch.pendingAppends !== undefined) {
    throw new IssueError("validation", "pendingAppends is system-written");
  }
  if (patch.releasedAt !== undefined) {
    throw new IssueError("validation", "releasedAt is system-written");
  }
}

export function validateSourceIdeaPatch(
  existing: Issue,
  patch: IssuePatch,
  issues: Issue[],
): void {
  if (!("sourceIdea" in patch)) return;
  const next = mergeIssue(existing, patch);
  if (next.kind !== "story") return;
  const parent = issues.find((issue) => issue.id === next.partOf);
  if (!parent) return;
  try {
    assertStoryCanSetSourceIdea(next, parent.kind);
  } catch (error) {
    throw new IssueError(
      "validation",
      error instanceof Error ? error.message : String(error),
    );
  }
}
