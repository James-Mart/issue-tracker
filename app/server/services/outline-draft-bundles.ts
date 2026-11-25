import type { Issue } from "../schemas.js";
import { appendTargetOutlineId } from "./append-target.js";
import { readAll } from "./issues.js";
import {
  liveReplayDirectionIds,
  moveNewReplayBundlesFromIdea,
} from "./outline-attachments.js";
import { recordDraftPredatedDirectionIdsOnce } from "./outline-draft-predated.js";

function appendIdeaIds(outlineId: string, issues: readonly Issue[]): string[] {
  const ids: string[] = [];
  for (const issue of issues) {
    if (issue.kind !== "idea" || issue.archived || !issue.appendTo) continue;
    if (appendTargetOutlineId(issues, issue.appendTo) !== outlineId) continue;
    ids.push(issue.id);
  }
  return ids;
}

/** Unarchived Ideas in `issues` whose append target is this outline. */
export function unarchivedAppendIdeaIds(
  outlineId: string,
  issues: readonly Issue[],
): string[] {
  return appendIdeaIds(outlineId, issues);
}

/**
 * Saving an append draft moves each new live bundle from the append Idea
 * onto the outline. Directions already live are the ones that predated the
 * draft; that set is recorded once, before the move.
 */
export function adoptAppendDraftBundles(outlineId: string): void {
  const { issues } = readAll();
  const ideaIds = appendIdeaIds(outlineId, issues);
  if (ideaIds.length === 0) return;
  recordDraftPredatedDirectionIdsOnce(outlineId, liveReplayDirectionIds(outlineId));
  for (const ideaId of ideaIds) moveNewReplayBundlesFromIdea(ideaId, outlineId);
}
