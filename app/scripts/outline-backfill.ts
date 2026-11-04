#!/usr/bin/env -S npx tsx
// One-time outline backfill. Each open root Epic and project-level Story with
// no `sourceOutline` gets an outline: one per source Idea, one per root without
// one. A planner on the source Idea's model (Grok without one) drafts it from
// the roots' Epic and Story prose and the Idea capture; the draft is saved as
// version 1 and stamped on the roots' trees. Merged and archived work stays
// unlinked.
//
// Run from app/ against the live store (`--dry-run` lists the groups only):
//   ISSUES_DIR=/root/.cursor/plugins/local/issue-tracker/issues npm run outline-backfill -- [--dry-run]

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildTree, issuesById, type IssueNode } from "../src/features/issues/lib/build-tree.js";
import { isIssueComplete } from "../src/features/issues/lib/derived.js";
import { outlinePlanningSessionModel } from "../src/features/issues/lib/outline-planning-launch.js";
import { issuesDir, pluginDir } from "../server/config.js";
import { bySequence, isProjectBoardChild } from "../server/order.js";
import type { DerivedState, IssueRecord } from "../server/schemas.js";
import { agentSdk, type AgentSdk } from "../server/services/agent-sdk.js";
import { outlineIssues } from "../server/services/archived-visibility.js";
import { create, list, update } from "../server/services/issues.js";
import { parseModelKey } from "../server/services/model-selection.js";
import { requireProjectWorkspace } from "../server/services/project-workspace.js";

type RootIssue = Extract<IssueRecord, { kind: "epic" | "story" }>;
type IdeaIssue = Extract<IssueRecord, { kind: "idea" }>;

export type BackfillGroup = {
  projectId: string;
  sourceIdea: IdeaIssue | undefined;
  roots: RootIssue[];
};

export type PlannerSdk = Pick<AgentSdk, "createAgent">;

const PLANNER_PROMPT_PATH = join(pluginDir, "agents", "_issue-tracker-outline-backfill.md");

/** Open, unarchived, unlinked roots grouped by source Idea, in board order. */
export function backfillGroups(
  issues: IssueRecord[],
  derived: Record<string, DerivedState>,
): BackfillGroup[] {
  const byId = issuesById(issues);
  const groups = new Map<string, BackfillGroup>();
  for (const issue of outlineIssues(issues, false).sort(bySequence)) {
    if (!needsOutline(issue, byId, derived)) continue;
    const key = issue.sourceIdea ?? issue.id;
    const group = groups.get(key) ?? {
      projectId: issue.partOf,
      sourceIdea: issue.sourceIdea ? ideaOf(issue.sourceIdea, byId) : undefined,
      roots: [],
    };
    group.roots.push(issue);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function needsOutline(
  issue: IssueRecord,
  byId: Map<string, IssueRecord>,
  derived: Record<string, DerivedState>,
): issue is RootIssue {
  if (issue.kind !== "epic" && issue.kind !== "story") return false;
  if (!isProjectBoardChild(issue, byId)) return false;
  if (issue.sourceOutline) return false;
  return !isIssueComplete(issue, derived[issue.id]);
}

function ideaOf(id: string, byId: Map<string, IssueRecord>): IdeaIssue {
  const idea = byId.get(id);
  if (idea?.kind !== "idea") throw new Error(`source idea "${id}" is not an idea`);
  return idea;
}

function groupLabel(group: BackfillGroup): string {
  return group.roots.map((root) => root.id).join(" ");
}

/** First prompt for the planner that drafts one group's outline into `bodyFile`. */
export function backfillPlannerMessage(group: BackfillGroup, bodyFile: string): string {
  const roots = group.roots.map((root) => `\`${root.id}\``).join(", ");
  return (
    `Backfill an outline in the issue tracker. ` +
    `Read ${PLANNER_PROMPT_PATH} and follow it. ` +
    `Source Idea: \`${group.sourceIdea?.id ?? "none"}\`. ` +
    `Roots: ${roots}. Body file: \`${bodyFile}\`.`
  );
}

/** Run the group's planner to completion and return the outline body it wrote. */
export async function draftBackfillOutline(
  group: BackfillGroup,
  sdk: PlannerSdk,
): Promise<string> {
  const scratch = mkdtempSync(join(tmpdir(), "outline-backfill-"));
  try {
    const storeDir = join(scratch, "agent-state");
    mkdirSync(storeDir);
    const bodyFile = join(scratch, "outline.md");
    await using handle = await sdk.createAgent({
      cwd: requireProjectWorkspace(group.projectId),
      model: parseModelKey(outlinePlanningSessionModel(group.sourceIdea?.stakeholder)),
      storeDir,
    });
    const run = await handle.send(backfillPlannerMessage(group, bodyFile));
    const result = await run.wait();
    if (result.status !== "finished") {
      const reason = result.error ? `: ${result.error.message}` : "";
      throw new Error(`planner for ${groupLabel(group)} ${result.status}${reason}`);
    }
    return requireOutlineShape(readFileSync(bodyFile, "utf8"), group);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function requireOutlineShape(body: string, group: BackfillGroup): string {
  const headings = body.split("\n").filter((line) => line.startsWith("# "));
  if (
    headings.length !== 2 ||
    headings[0] !== "# Background" ||
    headings[1] !== "# Implementation"
  ) {
    throw new Error(
      `planner for ${groupLabel(group)} wrote top-level headings ${JSON.stringify(headings)}, ` +
        `not "# Background" then "# Implementation"`,
    );
  }
  return body;
}

/** Save `body` as the group's outline version 1 and stamp it on each root's tree. */
export async function saveBackfillOutline(
  group: BackfillGroup,
  body: string,
): Promise<string> {
  const outline = await create({
    kind: "outline",
    partOf: group.projectId,
    title: (group.sourceIdea ?? group.roots[0]!).title,
    description: body,
    sourceIdea: group.sourceIdea?.id,
  });
  const sourceOutline = { outline: outline.id, version: 1 };
  for (const id of unmergedTreeIds(outlineIssues(list().issues, false), group.roots)) {
    await update(id, { sourceOutline });
  }
  return outline.id;
}

/**
 * Ids in the roots' trees minus merged Stories and their Tasks, each root after
 * its tree: a run that stops partway leaves that root unlinked, so the next run
 * redrafts it.
 */
function unmergedTreeIds(issues: IssueRecord[], roots: RootIssue[]): string[] {
  const ids: string[] = [];
  const visit = (node: IssueNode, parentMerged: boolean): void => {
    const merged = node.issue.kind === "story" ? node.issue.merged : parentMerged;
    for (const child of node.children) visit(child, merged);
    if (!merged) ids.push(node.issue.id);
  };
  for (const root of buildTree(issues, roots)) visit(root, false);
  return ids;
}

/** Draft, save, and stamp every group in turn; `dryRun` only lists them. */
export async function runOutlineBackfill(options: {
  dryRun: boolean;
  sdk: PlannerSdk;
  log: (line: string) => void;
}): Promise<void> {
  const { issues, derived } = list();
  for (const group of backfillGroups(issues, derived)) {
    if (options.dryRun) {
      const model = outlinePlanningSessionModel(group.sourceIdea?.stakeholder);
      options.log(`${group.sourceIdea?.id ?? "-"} ${model}: ${groupLabel(group)}`);
      continue;
    }
    const body = await draftBackfillOutline(group, options.sdk);
    const outlineId = await saveBackfillOutline(group, body);
    options.log(`${outlineId}: ${groupLabel(group)}`);
  }
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run")) {
    console.error("usage: outline-backfill [--dry-run]");
    process.exit(1);
  }
  if (!existsSync(issuesDir)) {
    console.error(`no tracker store at ${issuesDir}; set ISSUES_DIR to the live store`);
    process.exit(1);
  }
  await runOutlineBackfill({
    dryRun: args.includes("--dry-run"),
    sdk: agentSdk,
    log: (line) => process.stdout.write(`${line}\n`),
  });
}
