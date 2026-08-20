import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { Issue } from "../schemas.js";
import { forEachOnDiskIssue } from "./scan-disk.js";

const MIGRATION_FLAG = ".source-idea-migrated";

const SOURCE_IDEA_LINE =
  /^Source idea: \[[^\]]+\]\(issue:([^)]+)\)(?:\r?\n|\n|$)/;

function flagPath(): string {
  return join(issuesDir, MIGRATION_FLAG);
}

export function sourceIdeaMigrationDone(): boolean {
  return existsSync(flagPath());
}

export function markSourceIdeaMigrated(): void {
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}

function isPlanRootCandidate(issue: Issue, issuesById: Map<string, Issue>): boolean {
  if (issue.kind === "epic") return true;
  if (issue.kind !== "story" || issue.stackedOn) return false;
  const parent = issuesById.get(issue.partOf);
  return parent?.kind === "project";
}

function parseLeadingSourceIdeaLine(
  description: string,
): { ideaId: string; rest: string } | null {
  const match = description.match(SOURCE_IDEA_LINE);
  if (!match || match.index !== 0) return null;
  const ideaId = match[1]!;
  let rest = description.slice(match[0].length);
  if (rest.startsWith("\r\n")) rest = rest.slice(2);
  else if (rest.startsWith("\n")) rest = rest.slice(1);
  return { ideaId, rest };
}

function validSourceIdeaReferent(
  ideaId: string,
  root: Issue,
  issuesById: Map<string, Issue>,
): boolean {
  const idea = issuesById.get(ideaId);
  if (!idea || idea.kind !== "idea") return false;
  return idea.partOf === root.partOf;
}

export interface SourceIdeaMigrationResult {
  updated: string[];
  skipped: boolean;
}

// One-time: move `Source idea:` description lines onto `sourceIdea` in
// issue.json for Epics and root project-level Stories. Subsequent calls
// no-op once the marker file exists.
export function ensureSourceIdeaMigrated(): SourceIdeaMigrationResult {
  if (sourceIdeaMigrationDone()) return { updated: [], skipped: true };

  const onDisk = [...forEachOnDiskIssue()];
  const issuesById = new Map(onDisk.map(({ issue }) => [issue.id, issue]));
  const updated: string[] = [];

  for (const { id, raw, issue } of onDisk) {
    if (issue.id !== id) continue;
    if (!isPlanRootCandidate(issue, issuesById)) continue;
    if (issue.sourceIdea) continue;

    const descriptionPath = join(issuesDir, id, "description.md");
    if (!existsSync(descriptionPath)) continue;
    const description = readFileSync(descriptionPath, "utf8");
    const parsed = parseLeadingSourceIdeaLine(description);
    if (!parsed) continue;
    if (!validSourceIdeaReferent(parsed.ideaId, issue, issuesById)) continue;

    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    obj.sourceIdea = parsed.ideaId;
    writeFileSync(
      join(issuesDir, id, "issue.json"),
      `${JSON.stringify(obj, null, 2)}\n`,
    );
    writeFileSync(descriptionPath, parsed.rest);
    updated.push(id);
  }

  markSourceIdeaMigrated();
  return { updated, skipped: false };
}
