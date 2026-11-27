import { existsSync, rmSync } from "fs";
import { revertDraftMockups } from "./outline-draft-mockups.js";
import { removeDraftPredatedDirectionIds } from "./outline-draft-predated.js";
import {
  legacyOutlineDraftPath,
  outlineDraftPath,
  readOutlineDraft,
} from "./outline-draft-store.js";
import { forEachOnDiskIssue } from "./scan-disk.js";

/**
 * Drop pending drafts the outline-check gate does not own. A review-owned
 * `draft.json` stays. A legacy `draft.md`, or a `draft.json` that does not
 * record `review` and `submission`, is discarded, including its mockup
 * backups. A later pass no-ops once those files are gone.
 */
export function discardUnownedOutlineDrafts(): string[] {
  const discarded: string[] = [];
  for (const { id, issue } of forEachOnDiskIssue()) {
    if (issue.kind !== "outline") continue;
    const kind = unownedOutlineDraft(id);
    if (kind === undefined) continue;
    if (kind === "discard") revertDraftMockups(id);
    removeUnownedOutlineDraftFiles(id, kind);
    discarded.push(id);
  }
  return discarded;
}

/**
 * `discard` — a pending draft that does not record a review owner.
 * `stray-legacy` — a `draft.md` left beside a review-owned `draft.json`.
 */
type UnownedOutlineDraft = "discard" | "stray-legacy";

function unownedOutlineDraft(id: string): UnownedOutlineDraft | undefined {
  const owned = classifyDraftFile(id);
  const legacy = existsSync(legacyOutlineDraftPath(id));
  if (owned === "owned") return legacy ? "stray-legacy" : undefined;
  if (owned === "invalid" || legacy) return "discard";
  return undefined;
}

function classifyDraftFile(id: string): "owned" | "invalid" | "absent" {
  if (!existsSync(outlineDraftPath(id))) return "absent";
  try {
    readOutlineDraft(id);
    return "owned";
  } catch {
    // Startup scans whatever draft.json is on disk. One that does not parse
    // as a review-owned draft is discarded rather than served.
    return "invalid";
  }
}

function removeUnownedOutlineDraftFiles(id: string, kind: UnownedOutlineDraft): void {
  if (kind === "stray-legacy") {
    rmSync(legacyOutlineDraftPath(id), { force: true });
    return;
  }
  rmSync(outlineDraftPath(id), { force: true });
  rmSync(legacyOutlineDraftPath(id), { force: true });
  removeDraftPredatedDirectionIds(id);
}
