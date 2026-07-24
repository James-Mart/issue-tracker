import { hasAssignee } from "./kind.js";
import type { IssueRecord } from "./schemas.js";

/** Normalized assignee for read paths (CLI `view`/`assignee`, UI badges). */
export function assigneeOf(issue: IssueRecord): string | undefined {
  if (!hasAssignee(issue)) return undefined;
  const raw = issue.assignee;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
