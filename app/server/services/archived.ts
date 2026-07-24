import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { Issue, IssuePatch } from "../schemas.js";
import { forEachOnDiskIssue } from "./scan-disk.js";
import { subtreeIds } from "./subtree.js";

export {
  ancestorIsArchived,
  isArchived,
  visibleIssues,
} from "./archived-visibility.js";

const BACKFILL_FLAG = ".archived-backfilled";

export type ArchivedCascadePatch = { id: string; archived: boolean };

/**
 * When `archived` is patched on an Epic / Story / Task, plan the same value
 * for every partOf descendant. Independent child archive (parent stays
 * unarchived) is allowed when the patch is on the child alone.
 */
export function planArchivedCascade(
  existing: Issue,
  jsonPatch: IssuePatch,
  issues: Issue[],
): ArchivedCascadePatch[] {
  if (existing.kind === "project") return [];
  if (jsonPatch.archived === undefined) return [];
  const archived = jsonPatch.archived;
  const descendants = subtreeIds(issues, existing.id);
  descendants.delete(existing.id);
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const patches: ArchivedCascadePatch[] = [];
  for (const id of descendants) {
    const child = byId.get(id);
    if (!child || child.kind === "project") continue;
    if (child.archived === archived) continue;
    patches.push({ id, archived });
  }
  return patches;
}

function flagPath(): string {
  return join(issuesDir, BACKFILL_FLAG);
}

export function archivedBackfillDone(): boolean {
  return existsSync(flagPath());
}

export function markArchivedBackfilled(): void {
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}

export interface ArchivedBackfillResult {
  updated: string[];
  skipped: boolean;
}

// One-time: write `archived: false` on every Epic / Story / Task whose
// issue.json lacks the key. Subsequent calls no-op once the marker exists.
export function ensureArchivedBackfilled(
  persistIssue: (issue: Issue) => void,
): ArchivedBackfillResult {
  if (archivedBackfillDone()) return { updated: [], skipped: true };

  const updated: string[] = [];
  for (const { id, raw, issue } of forEachOnDiskIssue()) {
    if (issue.kind === "project") continue;
    if (!raw || typeof raw !== "object" || "archived" in raw) continue;
    // Skip id/directory mismatches — persist keys by issue.id and must not
    // create a sibling directory for a drifted issue.json.
    if (issue.id !== id) continue;
    persistIssue({ ...issue, archived: false });
    updated.push(id);
  }

  markArchivedBackfilled();
  return { updated, skipped: false };
}
