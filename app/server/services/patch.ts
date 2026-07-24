import type { Issue, IssuePatch } from "../schemas.js";
import { NON_CLEARABLE_MERGEABLE_KEYS } from "../fields.js";
import { IssueError } from "./errors.js";

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
