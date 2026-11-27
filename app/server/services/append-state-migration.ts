import { join } from "path";
import { issuesDir } from "../config.js";
import { replaceFileAtomically } from "./issues-store-lock.js";
import { forEachOnDiskIssue } from "./scan-disk.js";

export interface AppendStateMigrationResult {
  updated: string[];
}

/**
 * Delete stored `appendTo` on an Idea, `appendLock` on any issue, and
 * `pendingAppends` on an Outline. Rewrites an issue.json only when one of
 * those keys is still present, so a later pass can clear more keys on a
 * store this one already rewrote.
 */
export function ensureAppendStateCleared(): AppendStateMigrationResult {
  const updated: string[] = [];
  for (const { id, raw, issue } of forEachOnDiskIssue()) {
    if (issue.id !== id) continue;
    const obj = raw as Record<string, unknown>;
    let changed = false;
    if (issue.kind === "idea" && "appendTo" in obj) {
      delete obj.appendTo;
      changed = true;
    }
    if ("appendLock" in obj) {
      delete obj.appendLock;
      changed = true;
    }
    if (issue.kind === "outline" && "pendingAppends" in obj) {
      delete obj.pendingAppends;
      changed = true;
    }
    if (!changed) continue;
    replaceFileAtomically(
      join(issuesDir, id, "issue.json"),
      `${JSON.stringify(obj, null, 2)}\n`,
    );
    updated.push(id);
  }
  return { updated };
}
