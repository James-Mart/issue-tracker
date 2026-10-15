import type { IssueDetail, IssuePatch } from "../schemas.js";
import { readIssueOrThrow, update } from "./issues.js";
import {
  rootMergeSettingsFromStoredPatch,
  rootMergeSettingsPatch,
  withoutMergeSettings,
  type RootMergeSettingsInput,
  type RootMergeSettingsMode,
} from "./merge-settings-lock.js";

export type { RootMergeSettingsInput, RootMergeSettingsMode } from "./merge-settings-lock.js";

/**
 * Write a root's merge-base override, merge-policy override, or both.
 * Null or blank `mergeBase` clears the override so the root inherits Project
 * trunk. `"inherit"` clears the merge-policy override. `human` enforces the
 * lock; `system-revert` skips the lock and still enforces eligibility.
 * `rest` is applied in the same write (a PATCH that also changes other fields).
 */
export function setRootMergeSettings(
  id: string,
  settings: RootMergeSettingsInput,
  options: { mode: RootMergeSettingsMode },
  rest: IssuePatch = {},
): Promise<IssueDetail> {
  return update(id, { ...rest, ...rootMergeSettingsPatch(settings) }, {
    rootMergeSettings: options.mode,
  });
}

export function patchIssue(id: string, patch: IssuePatch): Promise<IssueDetail> {
  const existing = readIssueOrThrow(id);
  if (
    (existing.kind === "epic" || existing.kind === "story") &&
    ("mergeBaseOverride" in patch || "mergePolicy" in patch)
  ) {
    return setRootMergeSettings(
      id,
      rootMergeSettingsFromStoredPatch(patch),
      { mode: "human" },
      withoutMergeSettings(patch),
    );
  }
  return update(id, patch);
}
