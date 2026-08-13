import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import { forEachOnDiskIssue } from "./scan-disk.js";

const RENAME_FLAG = ".spec-review-renamed";

function flagPath(): string {
  return join(issuesDir, RENAME_FLAG);
}

export function specReviewRenameDone(): boolean {
  return existsSync(flagPath());
}

export function markSpecReviewRenamed(): void {
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}

export interface SpecReviewRenameResult {
  updated: string[];
  skipped: boolean;
}

// One-time: rewrite stored `specReview` → `review` on every on-disk Story
// issue.json. Subsequent calls no-op once the marker file exists.
export function ensureSpecReviewRenamed(): SpecReviewRenameResult {
  if (specReviewRenameDone()) return { updated: [], skipped: true };

  const updated: string[] = [];
  for (const { id, raw, issue } of forEachOnDiskIssue()) {
    if (issue.kind !== "story") continue;
    if (!raw || typeof raw !== "object" || !("specReview" in raw)) continue;
    // Skip id/directory mismatches — must not create a sibling directory.
    if (issue.id !== id) continue;
    const obj = raw as Record<string, unknown>;
    obj.review = obj.specReview;
    delete obj.specReview;
    writeFileSync(
      join(issuesDir, id, "issue.json"),
      `${JSON.stringify(obj, null, 2)}\n`,
    );
    updated.push(id);
  }

  markSpecReviewRenamed();
  return { updated, skipped: false };
}
