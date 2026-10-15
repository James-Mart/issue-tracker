import { MERGE_POLICIES, type MergePolicy } from "../issue-constants.js";
import {
  MERGE_BASE_SET_ERROR,
  MERGE_POLICY_SET_ERROR,
  isProjectLevelRootStory,
} from "../kind-fields.js";
import { bySequence } from "../order.js";
import { resolveMergeBase } from "../resolve-merge-base.js";
import type { Issue, IssuePatch, MergeSettingsLock } from "../schemas.js";
import { IssueError } from "./errors.js";
import { projectTrunk } from "./subtree.js";

type Story = Extract<Issue, { kind: "story" }>;

export type RootMergeSettingsMode = "human" | "system-revert";

export type RootMergeSettingsInput = {
  mergeBase?: string | null;
  mergePolicy?: MergePolicy | "inherit";
};

/** Attention reconcile stores when GitHub closed a pull request without merging. */
export function closedPullRequestAttentionReason(url: string): string {
  return `Closed pull request ${url}`;
}

const STORY_OPEN_PR =
  "Locked while this Story has an open pull request. Close it to change the base.";

function isMergePolicy(value: string): value is MergePolicy {
  return (MERGE_POLICIES as readonly string[]).includes(value);
}

function storyHasOpenPullRequest(story: Story): boolean {
  if (!story.prUrl || story.merged) return false;
  const closed =
    story.needsAttention &&
    story.attentionReason === closedPullRequestAttentionReason(story.prUrl);
  return !closed;
}

function mergedReason(
  story: Story,
  issues: Issue[],
  byId: Map<string, Issue>,
  voice: "self" | "child",
): string {
  const base = resolveMergeBase(story, issues, undefined, projectTrunk(story, byId), byId);
  if (!base) return "already merged";
  const who = voice === "self" ? "this Story" : `Story ${story.id}`;
  return `Locked while ${who} has already merged into ${base}.`;
}

function openReason(story: Story, voice: "self" | "child"): string {
  if (voice === "self") return STORY_OPEN_PR;
  return `Locked while Story ${story.id} has an open pull request. Close it to change the base.`;
}

function storyLockReason(
  story: Story,
  issues: Issue[],
  byId: Map<string, Issue>,
  voice: "self" | "child",
): string | undefined {
  if (story.merged) return mergedReason(story, issues, byId, voice);
  if (storyHasOpenPullRequest(story)) return openReason(story, voice);
  return undefined;
}

/**
 * Lock for an Epic or project-level root Story. Other issues return
 * `undefined` so their payloads omit the field. `epicChildren` is the
 * Epic's `partOf` stories when the caller already grouped them.
 */
export function mergeSettingsLockFor(
  issue: Issue,
  issues: Issue[],
  byId: Map<string, Issue> = new Map(issues.map((item) => [item.id, item])),
  epicChildren?: readonly Story[],
): MergeSettingsLock | undefined {
  if (issue.kind === "story") {
    if (!isProjectLevelRootStory(issue, byId.get(issue.partOf)?.kind)) return undefined;
    const reason = storyLockReason(issue, issues, byId, "self");
    return reason ? { locked: true, reason } : { locked: false };
  }
  if (issue.kind !== "epic") return undefined;
  const children = (
    epicChildren ??
    issues.filter((item): item is Story => item.kind === "story" && item.partOf === issue.id)
  ).slice().sort(bySequence);
  for (const child of children) {
    const reason = storyLockReason(child, issues, byId, "child");
    if (reason) return { locked: true, reason };
  }
  return { locked: false };
}

function eligibilityError(patch: IssuePatch): string {
  return "mergeBaseOverride" in patch ? MERGE_BASE_SET_ERROR : MERGE_POLICY_SET_ERROR;
}

/** Map stored merge-settings keys onto the operation input. */
export function rootMergeSettingsFromStoredPatch(patch: IssuePatch): RootMergeSettingsInput {
  const settings: RootMergeSettingsInput = {};
  if ("mergeBaseOverride" in patch) {
    const value = patch.mergeBaseOverride;
    settings.mergeBase = typeof value === "string" ? value : null;
  }
  if ("mergePolicy" in patch) {
    const value = patch.mergePolicy;
    if (value == null || value === "inherit") {
      settings.mergePolicy = "inherit";
    } else if (isMergePolicy(value)) {
      settings.mergePolicy = value;
    } else {
      throw new IssueError("validation", `invalid mergePolicy: ${value}`);
    }
  }
  return settings;
}

/** Map the operation input onto stored `mergeBaseOverride` / `mergePolicy` keys. */
export function rootMergeSettingsPatch(settings: RootMergeSettingsInput): IssuePatch {
  const patch: IssuePatch = {};
  if (settings.mergeBase !== undefined) {
    const value = settings.mergeBase;
    patch.mergeBaseOverride = value === null || value.trim() === "" ? null : value;
  }
  if (settings.mergePolicy !== undefined) {
    patch.mergePolicy = settings.mergePolicy === "inherit" ? null : settings.mergePolicy;
  }
  return patch;
}

export function withoutMergeSettings(patch: IssuePatch): IssuePatch {
  const rest = { ...patch };
  delete rest.mergeBaseOverride;
  delete rest.mergePolicy;
  return rest;
}

/**
 * Normalize a root merge-settings patch and refuse ineligible or locked writes.
 * Other patches are returned unchanged.
 */
export function guardRootMergeSettingsPatch(
  existing: Issue,
  patch: IssuePatch,
  issues: Issue[],
  mode: RootMergeSettingsMode,
  byId: Map<string, Issue>,
): IssuePatch {
  if (existing.kind !== "epic" && existing.kind !== "story") return patch;
  if (!("mergeBaseOverride" in patch) && !("mergePolicy" in patch)) return patch;

  const normalized = {
    ...withoutMergeSettings(patch),
    ...rootMergeSettingsPatch(rootMergeSettingsFromStoredPatch(patch)),
  };
  if (
    existing.kind === "story" &&
    !isProjectLevelRootStory(existing, byId.get(existing.partOf)?.kind)
  ) {
    throw new IssueError("validation", eligibilityError(patch));
  }
  if (mode === "system-revert") return normalized;
  const lock = mergeSettingsLockFor(existing, issues, byId);
  if (lock?.locked) throw new IssueError("merge-settings-locked", lock.reason);
  return normalized;
}
