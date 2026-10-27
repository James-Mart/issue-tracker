import { articleForKind, KIND_LABEL } from "@server/kind";
import type { DerivedState, IssueKind, IssueRecord } from "@server/schemas";
import { projectIdOf } from "./build-tree";

export const APPEND_TARGET_EMPTY_LABEL = "None — new Story";

export const APPEND_TARGET_NOT_FOUND =
  "No Story with that id in this Project.";

export const APPEND_TARGET_MERGED =
  "This Story is merged — it can no longer receive appended Tasks.";

export const APPEND_TARGET_UNSAVED_PLANNING =
  "Nothing saved yet — planning will create a new root Story.";

export { APPEND_TARGET_MERGED_PLANNING_BLOCKED } from "@server/append-planning-context";

type StoryRecord = Extract<IssueRecord, { kind: "story" }>;

/** Same-project Story named by a saved append target, when one resolves. */
export function appendStoryTarget(
  appendTo: string | null | undefined,
  ideaProjectId: string,
  byId: Map<string, IssueRecord>,
): StoryRecord | undefined {
  const id = appendTo?.trim();
  if (!id) return undefined;
  const target = byId.get(id);
  if (!target || target.kind !== "story") return undefined;
  if (projectIdOf(id, byId) !== ideaProjectId) return undefined;
  return target;
}

export function appendTargetWrongKindReason(kind: IssueKind): string {
  return `Append targets must be Stories — this id names ${articleForKind(kind)} ${KIND_LABEL[kind]}.`;
}

/** True when append-planning callout should show (caller checks valid target). */
export function appendPlanningCalloutVisible(
  appendTo: string | null | undefined,
  derived: Pick<DerivedState, "ideaStatus" | "planRoots"> | undefined,
): boolean {
  if (derived?.ideaStatus === "planned") return false;
  if (appendTo && (derived?.planRoots?.length ?? 0) > 0) return false;
  return true;
}

/** Per-field commit reason, or null when the draft may be saved. */
/** True when the append target is historical and must not be edited. */
export function appendTargetFieldIsReadOnly(
  appendTo: string | null | undefined,
  derived: Pick<DerivedState, "ideaStatus" | "planRoots"> | undefined,
  targetMerged: boolean,
): boolean {
  if (targetMerged) return false;
  if (derived?.ideaStatus === "planned") return true;
  if (appendTo && (derived?.planRoots?.length ?? 0) > 0) return true;
  return false;
}

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
