import { isProjectLevelRootStory } from "../kind-fields.js";
import type { Issue } from "../schemas.js";
import { IssueError } from "./errors.js";
import { readAll, readIssueOrThrow } from "./issues.js";
import {
  githubBranchName,
  pullRequestAliases,
  pullRequestsField,
  queryRepository,
  resolveProjectGitHubRepo,
} from "./project-github.js";
import { setRootMergeSettings } from "./root-merge-settings.js";
import { projectTrunk, subtreeIds } from "./subtree.js";

type Epic = Extract<Issue, { kind: "epic" }>;
type Story = Extract<Issue, { kind: "story" }>;

type Root = {
  id: string;
  head: string;
  base: string;
};

export type MergeBaseAutoRevertResult = {
  reverted: string[];
  error?: string;
};

/**
 * Clear a root merge-base override once that branch has a merged pull request
 * into the Project trunk. A GitHub read failure returns `error` and leaves
 * every override in place. Merge-policy overrides are not written.
 */
export async function revertLandedRootMergeBases(
  projectId: string,
): Promise<MergeBaseAutoRevertResult> {
  const project = readIssueOrThrow(projectId);
  if (project.kind !== "project") {
    throw new IssueError("not_found", `unknown issue "${projectId}"`);
  }

  const { issues } = readAll();
  const roots = selectRoots(projectId, issues);
  if (roots.length === 0) return { reverted: [] };

  const repo = await resolveProjectGitHubRepo(project);
  if ("error" in repo) return { reverted: [], error: repo.error };

  const merged = await lookupMerged(repo.workspace, repo.owner, repo.repo, roots);
  if ("error" in merged) return { reverted: [], error: merged.error };

  const reverted: string[] = [];
  for (const root of roots) {
    if (!merged.landed.has(root.id)) continue;
    await setRootMergeSettings(root.id, { mergeBase: null }, { mode: "system-revert" });
    reverted.push(root.id);
  }
  return { reverted };
}

function isEligibleRoot(
  issue: Issue,
  byId: Map<string, Issue>,
): issue is Epic | Story {
  if (issue.kind === "epic") return true;
  if (issue.kind !== "story") return false;
  return isProjectLevelRootStory(issue, byId.get(issue.partOf)?.kind);
}

function selectRoots(projectId: string, issues: Issue[]): Root[] {
  const inProject = subtreeIds(issues, projectId);
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const roots: Root[] = [];
  for (const issue of issues) {
    if (!inProject.has(issue.id) || !isEligibleRoot(issue, byId)) continue;
    const override = issue.mergeBaseOverride;
    if (!override) continue;
    const trunk = projectTrunk(issue, byId);
    const head = githubBranchName(override);
    const base = githubBranchName(trunk);
    if (head === base) continue;
    roots.push({ id: issue.id, head, base });
  }
  roots.sort((a, b) => a.id.localeCompare(b.id));
  return roots;
}

function mergedFields(roots: Root[]): string {
  return roots
    .map((root, index) =>
      pullRequestsField({
        alias: `r_${index}`,
        first: 1,
        states: "MERGED",
        head: root.head,
        base: root.base,
        nodes: "{ number }",
      }),
    )
    .join("\n    ");
}

async function lookupMerged(
  workspace: string,
  owner: string,
  repo: string,
  roots: Root[],
): Promise<{ landed: Set<string> } | { error: string }> {
  const queried = await queryRepository(workspace, owner, repo, mergedFields(roots));
  if ("error" in queried) return queried;

  const read = pullRequestAliases(
    queried.repository,
    roots.map((_, index) => `r_${index}`),
  );
  if ("error" in read) return read;

  const landed = new Set<string>();
  for (let index = 0; index < roots.length; index++) {
    const root = roots[index]!;
    // A null entry is an empty slot in the connection, not a merged pull
    // request and not a failed read. A missing connection is an error above.
    const nodes = read.connections.get(`r_${index}`)!;
    if (nodes.some((node) => node != null)) landed.add(root.id);
  }
  return { landed };
}
