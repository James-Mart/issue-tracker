import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { Issue, IssuePatch } from "../schemas.js";
import { CHIP_UNSET, EPIC_BASE } from "../fields.js";
import { resolveMergeBase } from "../resolve-merge-base.js";
import { forEachOnDiskIssue } from "./scan-disk.js";

// Re-exported from the client-safe `fields` / resolve modules so callers that
// already import this service keep a stable surface. Browser code must import
// the pure helpers from `fields` / `resolve-merge-base` instead.
export { CHIP_UNSET, EPIC_BASE, resolveMergeBase };

const STRIP_FLAG = ".merge-base-stripped";

type Story = Extract<Issue, { kind: "story" }>;

/** Branches whose `stackedOn` is `parentId` (direct children only). */
export function stackedChildren(parentId: string, issues: Issue[]): Story[] {
  return issues.filter(
    (issue): issue is Story =>
      issue.kind === "story" && issue.stackedOn === parentId,
  );
}

/**
 * Refuse a real `branchName` change (not a same-value no-op) while any child is
 * stacked on this Story. Returns an error message, or null when allowed.
 */
export function branchNameRenameError(
  existing: Issue,
  jsonPatch: IssuePatch,
  issues: Issue[],
): string | null {
  if (existing.kind !== "story" || !existing.branchName) return null;
  if (!("branchName" in jsonPatch) || jsonPatch.branchName === undefined) {
    return null;
  }
  if (jsonPatch.branchName === existing.branchName) return null;
  const children = stackedChildren(existing.id, issues);
  if (children.length === 0) return null;
  const ids = children.map((child) => child.id).join(", ");
  return `cannot change branchName on "${existing.id}" while stacked children exist (${ids})`;
}

function flagPath(): string {
  return join(issuesDir, STRIP_FLAG);
}

export function mergeBaseStripDone(): boolean {
  return existsSync(flagPath());
}

export function markMergeBaseStripped(): void {
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}

export interface MergeBaseStripResult {
  updated: string[];
  skipped: boolean;
}

// One-time: remove stored `mergeBase` keys from every on-disk Story issue.json.
// Subsequent calls are no-ops once the marker file exists.
export function ensureMergeBaseStripped(
  persistStory: (issue: Story) => void,
): MergeBaseStripResult {
  if (mergeBaseStripDone()) return { updated: [], skipped: true };

  const updated: string[] = [];
  for (const { id, raw, issue } of forEachOnDiskIssue()) {
    if (issue.kind !== "story") continue;
    if (!raw || typeof raw !== "object" || !("mergeBase" in raw)) continue;
    // Skip id/directory mismatches — persist keys by issue.id and must not
    // create a sibling directory for a drifted issue.json.
    if (issue.id !== id) continue;
    persistStory(issue);
    updated.push(id);
  }

  markMergeBaseStripped();
  return { updated, skipped: false };
}
