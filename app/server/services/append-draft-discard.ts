import type { Issue } from "../schemas.js";
import { appendTargetOutlineId } from "./append-target.js";
import { revertDraftMockups } from "./outline-draft-mockups.js";
import { discardOutlineDraftIfPresent } from "./outline-draft-store.js";

/** Outlines whose unpublished drafts these ideas would drop, in id order. */
export function unpublishedAppendOutlineIds(
  issues: readonly Issue[],
  ideaIds: readonly string[],
): string[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const outlines: string[] = [];
  for (const id of ideaIds) {
    const target = appendDiscardTarget(byId.get(id), byId);
    if (target) outlines.push(target.outlineId);
  }
  return [...new Set(outlines)].sort();
}

/**
 * Drop the unpublished draft of each append Idea in `ideaIds`.
 * Conclude publishes that draft; archive and delete without conclude discard it.
 * The current outline version is left as it is. Bundles the draft added go
 * back onto that Idea, and backups are written onto the live bundles.
 * Caller holds each target outline's mockup lock.
 */
export function discardUnpublishedAppendDrafts(
  issues: readonly Issue[],
  ideaIds: readonly string[],
): void {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  for (const id of ideaIds) {
    const target = appendDiscardTarget(byId.get(id), byId);
    if (!target) continue;
    revertDraftMockups(target.outlineId, [target.ideaId]);
    discardOutlineDraftIfPresent(target.outlineId);
  }
}

function appendDiscardTarget(
  idea: Issue | undefined,
  byId: ReadonlyMap<string, Issue>,
): { outlineId: string; ideaId: string } | undefined {
  if (idea?.kind !== "idea" || !idea.appendTo) return undefined;
  const outlineId = appendTargetOutlineId([...byId.values()], idea.appendTo);
  if (!outlineId) return undefined;
  return { outlineId, ideaId: idea.id };
}
