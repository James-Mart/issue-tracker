import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { Issue } from "../schemas.js";
import { withIdeaPlanSettings } from "./outline-plan-settings.js";
import { forEachOnDiskIssue } from "./scan-disk.js";
import { implementingWorkRootFromIssue } from "./work-slots.js";

const MIGRATION_FLAG = ".release-migrated";

type OutlineIssue = Extract<Issue, { kind: "outline" }>;

function flagPath(): string {
  return join(issuesDir, MIGRATION_FLAG);
}

function archivedIdea(
  id: string | undefined,
  byId: Map<string, Issue>,
): Extract<Issue, { kind: "idea" }> | undefined {
  const idea = id === undefined ? undefined : byId.get(id);
  return idea?.kind === "idea" && idea.archived ? idea : undefined;
}

/**
 * The outline after migration, or undefined when it already stores its plan
 * settings. An outline with no stored `outOfBand` predates that setting, so it
 * was planned for implementation in the tracker.
 */
function migratedOutline(
  outline: OutlineIssue,
  byId: Map<string, Issue>,
): OutlineIssue | undefined {
  const idea = archivedIdea(outline.sourceIdea, byId);
  if (idea && outline.executionGate === undefined) {
    return withIdeaPlanSettings(
      outline,
      idea,
      idea.codeApprovalRequired === true,
    );
  }
  if (outline.outOfBand === undefined) return { ...outline, outOfBand: false };
  return undefined;
}

export interface ReleaseMigrationResult {
  updated: string[];
  skipped: boolean;
}

/**
 * One-time: a work root whose source Idea is already archived counts as
 * released, that Idea's plan settings move onto its outline, and every
 * outline stores `outOfBand`. Later calls no-op once the marker exists.
 */
export function ensureReleaseMigrated(
  persistIssue: (issue: Issue) => void,
): ReleaseMigrationResult {
  if (existsSync(flagPath())) return { updated: [], skipped: true };

  const issues = [...forEachOnDiskIssue()]
    .filter(({ id, issue }) => issue.id === id)
    .map(({ issue }) => issue);
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const now = new Date().toISOString();
  const updated: string[] = [];

  for (const issue of issues) {
    let next: Issue | undefined;
    if (issue.kind === "outline") {
      next = migratedOutline(issue, byId);
    } else {
      const root = implementingWorkRootFromIssue(issue, byId);
      if (root && !root.releasedAt && archivedIdea(root.sourceIdea, byId)) {
        next = { ...root, releasedAt: now };
      }
    }
    if (!next) continue;
    persistIssue(next);
    updated.push(issue.id);
  }

  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
  return { updated, skipped: false };
}
