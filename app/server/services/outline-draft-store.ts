import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { dirname, join } from "path";
import { issuesDir } from "../config.js";
import {
  outlinePendingDraftSchema,
  type OutlinePendingDraft,
} from "../schemas.js";
import { IssueError } from "./errors.js";
import { replaceFileAtomically } from "./issues-store-lock.js";
import { removeDraftPredatedDirectionIds } from "./outline-draft-predated.js";

/** A review-owned pending draft. Absent when the outline has none. */
export function outlineDraftPath(id: string): string {
  return join(issuesDir, id, "draft.json");
}

/** Body-only draft from before drafts recorded a review owner. */
export function legacyOutlineDraftPath(id: string): string {
  return join(issuesDir, id, "draft.md");
}

/**
 * Pending draft, or `undefined` when the outline has none.
 * A present file that is not `{ body, review, submission }` is an error.
 */
export function readOutlineDraft(id: string): OutlinePendingDraft | undefined {
  const path = outlineDraftPath(id);
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new IssueError("validation", `invalid outline draft at ${path}: ${detail}`);
  }
  const parsed = outlinePendingDraftSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IssueError(
      "validation",
      `invalid outline draft at ${path}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export function writeOutlineDraft(id: string, draft: OutlinePendingDraft): void {
  const path = outlineDraftPath(id);
  mkdirSync(dirname(path), { recursive: true });
  replaceFileAtomically(path, `${JSON.stringify(draft, null, 2)}\n`);
}

export function removeOutlineDraft(id: string): void {
  const path = outlineDraftPath(id);
  if (!existsSync(path)) {
    throw new IssueError("validation", `outline "${id}" has no pending draft`);
  }
  rmSync(path);
  removeDraftPredatedDirectionIds(id);
}

/** Drop the draft after publish when it is still the body that was saved. */
export function removeOutlineDraftIfUnchanged(id: string, body: string): void {
  if (readOutlineDraft(id)?.body === body) removeOutlineDraft(id);
}

/** Drop the pending draft when one exists. Absent is a no-op. */
export function discardOutlineDraftIfPresent(id: string): void {
  const path = outlineDraftPath(id);
  if (!existsSync(path)) return;
  rmSync(path);
  removeDraftPredatedDirectionIds(id);
}
