import type { Issue, IssuePatch } from "../schemas.js";
import { NON_CLEARABLE_MERGEABLE_KEYS } from "../fields.js";
import { assertStoryCanSetSourceIdea } from "../kind-fields.js";
import { IssueError } from "./errors.js";
import { mergeIssue } from "./merge.js";
import { projectContaining } from "./subtree.js";

export const APPEND_TO_NOT_FOUND_ERROR = (targetId: string) =>
  `appendTo "${targetId}" names nothing in this Project`;

export const APPEND_TO_WRONG_KIND_ERROR = (targetId: string, kind: string) =>
  `appendTo "${targetId}" must name a Story; append targets are Stories, not a ${kind}`;

export const APPEND_TO_MERGED_ERROR = (targetId: string) =>
  `appendTo cannot target merged Story "${targetId}"`;

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

export function validateAppendToPatch(
  existing: Issue,
  patch: IssuePatch,
  issues: Issue[],
): void {
  if (existing.kind !== "idea" || !("appendTo" in patch)) return;
  const nextAppendTo = patch.appendTo;
  if (nextAppendTo === null || nextAppendTo === undefined) return;

  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const target = byId.get(nextAppendTo);
  const ideaProject = existing.partOf;
  const targetProject =
    target !== undefined ? projectContaining(target, byId) : undefined;

  if (!target || targetProject !== ideaProject) {
    throw new IssueError("validation", APPEND_TO_NOT_FOUND_ERROR(nextAppendTo));
  }
  if (target.kind !== "story") {
    throw new IssueError(
      "validation",
      APPEND_TO_WRONG_KIND_ERROR(nextAppendTo, target.kind),
    );
  }
  if (target.merged) {
    throw new IssueError("validation", APPEND_TO_MERGED_ERROR(nextAppendTo));
  }
}
