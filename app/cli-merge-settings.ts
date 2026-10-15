import type { IssueDetail, IssuePatch } from "./server/schemas.js";
import { setRootMergeSettings } from "./server/services/root-merge-settings.js";
import { rootMergeSettingsFromStoredPatch } from "./server/services/merge-settings-lock.js";

/** `mergePolicy inherit` clears the override; enum coercion would reject that word. */
export function isMergePolicyInheritValue(
  kind: string,
  field: string,
  value: string | undefined,
  opts: { clear?: boolean; file?: string; add?: unknown; remove?: unknown },
): boolean {
  return (
    (kind === "epic" || kind === "story") &&
    field === "mergePolicy" &&
    value === "inherit" &&
    !opts.clear &&
    opts.file === undefined &&
    opts.add === undefined &&
    opts.remove === undefined
  );
}

/** Send an epic or story mergeBase/mergePolicy set through `setRootMergeSettings`. */
export function applyMergeSettingsSet(
  kind: string,
  id: string,
  field: string,
  patch: IssuePatch,
): Promise<IssueDetail> | undefined {
  if (kind !== "epic" && kind !== "story") return undefined;
  if (field !== "mergeBase" && field !== "mergePolicy") return undefined;
  return setRootMergeSettings(id, rootMergeSettingsFromStoredPatch(patch), {
    mode: "human",
  });
}
