import { articleForKind, KIND_LABEL } from "@server/kind";
import type { IssueKind, IssueRecord } from "@server/schemas";
import { projectIdOf } from "./build-tree";

export const APPEND_TARGET_EMPTY_LABEL = "None — new Story";

export const APPEND_TARGET_NOT_FOUND =
  "No Story with that id in this Project.";

export const APPEND_TARGET_MERGED =
  "This Story is merged — it can no longer receive appended Tasks.";

export const APPEND_TARGET_UNSAVED_PLANNING =
  "Nothing saved yet — planning will create a new root Story.";

export function appendTargetWrongKindReason(kind: IssueKind): string {
  return `Append targets must be Stories — this id names ${articleForKind(kind)} ${KIND_LABEL[kind]}.`;
}

/** Per-field commit reason, or null when the draft may be saved. */
export function appendTargetCommitError(
  draft: string,
  ideaProjectId: string,
  byId: Map<string, IssueRecord>,
): string | null {
  const id = draft.trim();
  if (!id) return null;

  const target = byId.get(id);
  if (!target || projectIdOf(id, byId) !== ideaProjectId) {
    return APPEND_TARGET_NOT_FOUND;
  }
  if (target.kind !== "story") {
    return appendTargetWrongKindReason(target.kind);
  }
  if (target.merged) {
    return APPEND_TARGET_MERGED;
  }
  return null;
}
