import { join } from "path";
import { issuesDir } from "../config.js";
import { replaceFileAtomically } from "./issues-store-lock.js";
import { forEachRawIssueJson } from "./scan-disk.js";

export interface AppendStateMigrationResult {
  updated: string[];
}

/** Drop every stored `coveredBy` key. Returns whether the value changed. */
function clearCoveredBy(value: unknown): boolean {
  if (Array.isArray(value)) {
    let changed = false;
    for (const item of value) {
      if (clearCoveredBy(item)) changed = true;
    }
    return changed;
  }
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  let changed = false;
  if ("coveredBy" in obj) {
    delete obj.coveredBy;
    changed = true;
  }
  for (const child of Object.values(obj)) {
    if (clearCoveredBy(child)) changed = true;
  }
  return changed;
}

/**
 * Delete stored `appendTo` on an Idea, `appendLock` on any issue,
 * `pendingAppends` on an Outline, and any `coveredBy` key. Rewrites an
 * issue.json only when one of those keys is still present, so a later pass
 * can clear more keys on a store this one already rewrote.
 */
export function ensureAppendStateCleared(): AppendStateMigrationResult {
  const updated: string[] = [];
  for (const { id, raw } of forEachRawIssueJson()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    if (obj.id !== id) continue;
    let changed = false;
    if (obj.kind === "idea" && "appendTo" in obj) {
      delete obj.appendTo;
      changed = true;
    }
    if ("appendLock" in obj) {
      delete obj.appendLock;
      changed = true;
    }
    if (obj.kind === "outline" && "pendingAppends" in obj) {
      delete obj.pendingAppends;
      changed = true;
    }
    if (clearCoveredBy(obj)) changed = true;
    if (!changed) continue;
    replaceFileAtomically(
      join(issuesDir, id, "issue.json"),
      `${JSON.stringify(obj, null, 2)}\n`,
    );
    updated.push(id);
  }
  return { updated };
}
