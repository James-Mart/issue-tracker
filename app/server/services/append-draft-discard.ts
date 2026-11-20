import type { Issue } from "../schemas.js";
import { outlineIdOnStory } from "./append-target.js";
import { discardOutlineDraftIfPresent } from "./outline-draft-store.js";

/**
 * Drop the unpublished draft of each append Idea in `ideaIds`.
 * Conclude publishes that draft; archive and delete without conclude discard it.
 * The current outline version is left as it is.
 */
export function discardUnpublishedAppendDrafts(
  issues: readonly Issue[],
  ideaIds: readonly string[],
): void {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  for (const id of ideaIds) {
    const idea = byId.get(id);
    if (idea?.kind !== "idea" || !idea.appendTo) continue;
    const outlineId = outlineIdOnStory(byId.get(idea.appendTo));
    if (!outlineId) continue;
    discardOutlineDraftIfPresent(outlineId);
  }
}
