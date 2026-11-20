import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { Issue } from "../schemas.js";
import { derive } from "./derive.js";
import { ideaPlanningArtifactIds } from "./planning-work-root.js";
import { forEachOnDiskIssue } from "./scan-disk.js";

const MIGRATION_FLAG = ".plan-settings-migrated";

type IdeaRecord = Extract<Issue, { kind: "idea" }>;

/** Idea keys the schema no longer parses; `approvePlan` is the name `outlineGate` replaced. */
type RetiredIdeaKeys = {
  outlineGate?: unknown;
  approvePlan?: unknown;
  approvalPending?: unknown;
};

const PLAN_SETTING_KEYS = ["decompositionGate", "executionGate", "outOfBand"] as const;
const RETIRED_KEYS: (keyof RetiredIdeaKeys)[] = ["outlineGate", "approvePlan", "approvalPending"];

function storesPlanSettings(raw: Record<string, unknown>): boolean {
  return (
    PLAN_SETTING_KEYS.every((key) => key in raw) && !RETIRED_KEYS.some((key) => key in raw)
  );
}

function flagPath(): string {
  return join(issuesDir, MIGRATION_FLAG);
}

export function planSettingsMigrationDone(): boolean {
  return existsSync(flagPath());
}

export function markPlanSettingsMigrated(): void {
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}

/** Unarchived Ideas with a saved outline and no plan root: the planner is waiting on the outline question. */
function ideasAwaitingOutlineAnswer(issues: Issue[]): Set<string> {
  const { outlined } = ideaPlanningArtifactIds(issues);
  const derived = derive(issues).byId;
  const awaiting = new Set<string>();
  for (const id of outlined) {
    if ((derived[id]?.planRoots ?? []).length === 0) awaiting.add(id);
  }
  return awaiting;
}

function decompositionGateFromRetiredKeys(
  idea: IdeaRecord,
  retired: RetiredIdeaKeys,
  awaitingOutlineAnswer: boolean,
): boolean {
  const outlineGate = retired.outlineGate ?? retired.approvePlan;
  if (idea.archived) return outlineGate === true;
  if (retired.approvalPending === true || awaitingOutlineAnswer) return true;
  if (typeof outlineGate === "boolean") return outlineGate;
  return !idea.stakeholder;
}

export interface PlanSettingsMigrationResult {
  updated: string[];
  skipped: boolean;
}

// Reads the retired keys from the raw record because parsing drops them.
export function ensurePlanSettingsMigrated(
  persistIssue: (issue: Issue) => void,
): PlanSettingsMigrationResult {
  if (planSettingsMigrationDone()) return { updated: [], skipped: true };

  const onDisk = [...forEachOnDiskIssue()];
  const awaiting = ideasAwaitingOutlineAnswer(onDisk.map(({ issue }) => issue));
  const updated: string[] = [];

  for (const { id, raw, issue } of onDisk) {
    const record = raw as Record<string, unknown>;
    if (issue.kind !== "idea" || issue.id !== id || storesPlanSettings(record)) continue;
    persistIssue({
      ...issue,
      decompositionGate: decompositionGateFromRetiredKeys(issue, record, awaiting.has(id)),
    });
    updated.push(id);
  }

  markPlanSettingsMigrated();
  return { updated, skipped: false };
}
