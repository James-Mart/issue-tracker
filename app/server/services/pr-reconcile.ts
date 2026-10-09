import type { Issue, IssuePatch } from "../schemas.js";
import { bySequence } from "../order.js";
import { derive } from "./derive.js";
import {
  mapReconcilePullRequest,
  parseGhGraphqlRepository,
  parseGitHubOrigin,
  PR_SELECTION,
  runGh,
  type MappedPullRequest,
  type PrFacts,
} from "./delivery.js";
import { IssueError } from "./errors.js";
import { getOriginRemoteUrl } from "./git-read.js";
import { readAll, readIssueOrThrow, update } from "./issues.js";
import { subtreeIds } from "./subtree.js";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const PRS_PER_REF = 20;

type Story = Extract<Issue, { kind: "story" }>;
type Task = Extract<Issue, { kind: "task" }>;

type Candidate = {
  story: Story;
  head: string;
  mergeBase: string;
};

type Found = MappedPullRequest;

export type PrReconcileWrite = {
  storyId: string;
  fields: IssuePatch;
};

export type PrReconcileResult = {
  checked: number;
  writes: PrReconcileWrite[];
  matches: Map<string, string>;
  facts: Map<string, PrFacts>;
  error?: string;
};

function blank(checked: number, error?: string): PrReconcileResult {
  return {
    checked,
    writes: [],
    matches: new Map(),
    facts: new Map(),
    ...(error !== undefined ? { error } : {}),
  };
}

function inCandidateWindow(story: Story, now: number): boolean {
  if (!story.merged) return true;
  // A merged Story with no usable mergedAt is outside the window.
  if (!story.mergedAt) return false;
  const mergedAtMs = Date.parse(story.mergedAt);
  if (Number.isNaN(mergedAtMs)) return false;
  return now - mergedAtMs <= THREE_DAYS_MS;
}

/**
 * A merge base override may name the remote-tracking ref (`origin/main`).
 * GitHub's `baseRefName` is the bare branch name.
 */
function githubBranchName(mergeBase: string): string {
  return mergeBase.replace(/^(refs\/remotes\/)?origin\//, "");
}

function selectCandidates(
  projectId: string,
  issues: Issue[],
  now: number,
): Candidate[] {
  const inProject = subtreeIds(issues, projectId);
  const { byId } = derive(issues);
  const candidates: Candidate[] = [];
  for (const issue of issues) {
    if (issue.kind !== "story") continue;
    if (!inProject.has(issue.id)) continue;
    if (issue.archived) continue;
    if (!issue.branchName) continue;
    if (!inCandidateWindow(issue, now)) continue;
    const mergeBase = byId[issue.id]?.mergeBase;
    if (!mergeBase) continue;
    candidates.push({
      story: issue,
      head: issue.branchName,
      mergeBase: githubBranchName(mergeBase),
    });
  }
  candidates.sort((a, b) => a.story.id.localeCompare(b.story.id));
  return candidates;
}

function pullRequestField(
  alias: string,
  states: string,
  head: string,
  base: string,
): string {
  return `${alias}: pullRequests(first: ${PRS_PER_REF}, states: [${states}], headRefName: ${JSON.stringify(head)}, baseRefName: ${JSON.stringify(base)}) {
      nodes ${PR_SELECTION}
    }`;
}

function buildRepoQuery(owner: string, repo: string, candidates: Candidate[]): string {
  const fields = candidates
    .map((candidate, index) => {
      const live = pullRequestField(
        `c_${index}_live`,
        "OPEN, MERGED",
        candidate.head,
        candidate.mergeBase,
      );
      const closed = pullRequestField(
        `c_${index}_closed`,
        "CLOSED",
        candidate.head,
        candidate.mergeBase,
      );
      return `${live}\n    ${closed}`;
    })
    .join("\n    ");
  return `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
    ${fields}
  }
}`;
}

function nodesOf(connection: unknown): unknown[] {
  if (
    typeof connection !== "object" ||
    connection === null ||
    !("nodes" in connection) ||
    !Array.isArray((connection as { nodes: unknown }).nodes)
  ) {
    throw new IssueError(
      "gh-failed",
      "gh graphql returned an unexpected pull request",
    );
  }
  return (connection as { nodes: unknown[] }).nodes;
}

function foundFromNodes(nodes: unknown[]): Found[] {
  const found: Found[] = [];
  for (const node of nodes) {
    if (node == null) continue;
    found.push(mapReconcilePullRequest(node));
  }
  return found;
}

function later(a: Found, b: Found): Found {
  const aTime = Date.parse(a.facts.updatedAt);
  const bTime = Date.parse(b.facts.updatedAt);
  if (aTime !== bTime) return aTime > bTime ? a : b;
  return a.facts.number >= b.facts.number ? a : b;
}

function newest(found: Found[]): Found | undefined {
  return found.reduce<Found | undefined>(
    (best, pr) => (best === undefined ? pr : later(pr, best)),
    undefined,
  );
}

/** Open or merged beats any closed PR. Within a tier, the newest update wins. */
function winningPullRequest(live: Found[], closed: Found[]): Found | undefined {
  return newest(live) ?? newest(closed);
}

function unfinishedTaskReason(ids: string[]): string {
  return `Tasks not done: ${ids.join(", ")}`;
}

function closedPrReason(url: string): string {
  return `Closed pull request ${url}`;
}

function attentionIfChanged(
  story: Story,
  reason: string,
  fields: IssuePatch,
): void {
  if (story.needsAttention && story.attentionReason === reason) return;
  fields.needsAttention = true;
  fields.attentionReason = reason;
}

function outcomePatch(
  story: Story,
  winner: Found,
  tasks: Task[],
): IssuePatch | undefined {
  const fields: IssuePatch = {};
  if (story.prUrl !== winner.facts.url) fields.prUrl = winner.facts.url;

  if (winner.facts.state === "merged") {
    if (!story.merged) {
      fields.merged = true;
      if (winner.mergedAt !== undefined) fields.mergedAt = winner.mergedAt;
    }
    const unfinished = tasks
      .filter((task) => task.status !== "done")
      .sort(bySequence)
      .map((task) => task.id);
    if (unfinished.length > 0) {
      attentionIfChanged(story, unfinishedTaskReason(unfinished), fields);
    }
  } else if (winner.facts.state === "closed") {
    attentionIfChanged(story, closedPrReason(winner.facts.url), fields);
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function tasksByStory(issues: Issue[]): Map<string, Task[]> {
  const byStory = new Map<string, Task[]>();
  for (const issue of issues) {
    if (issue.kind !== "task") continue;
    const bucket = byStory.get(issue.partOf) ?? [];
    bucket.push(issue);
    byStory.set(issue.partOf, bucket);
  }
  return byStory;
}

async function lookup(
  workspace: string,
  owner: string,
  repo: string,
  candidates: Candidate[],
): Promise<{ error: string } | Map<string, Found>> {
  const query = buildRepoQuery(owner, repo, candidates);
  try {
    const stdout = await runGh(
      ["api", "graphql", "-f", `query=${query}`],
      workspace,
    );
    const repository = parseGhGraphqlRepository(stdout);
    if (!repository) return { error: "gh graphql returned no repository" };

    const foundByStory = new Map<string, Found>();
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index]!;
      const live = foundFromNodes(nodesOf(repository[`c_${index}_live`]));
      const closed = foundFromNodes(nodesOf(repository[`c_${index}_closed`]));
      const winner = winningPullRequest(live, closed);
      if (winner) foundByStory.set(candidate.story.id, winner);
    }
    return foundByStory;
  } catch (err) {
    if (err instanceof IssueError) return { error: err.message };
    throw err;
  }
}

/**
 * Reconcile one Project's Story PR state from GitHub.
 * `gh` failures return `error` and write nothing.
 */
export async function reconcileProjectPrs(
  projectId: string,
): Promise<PrReconcileResult> {
  const project = readIssueOrThrow(projectId);
  if (project.kind !== "project") {
    throw new IssueError("not_found", `unknown issue "${projectId}"`);
  }

  const { issues } = readAll();
  const candidates = selectCandidates(projectId, issues, Date.now());
  if (candidates.length === 0) return blank(0);

  if (!project.workspace) return blank(candidates.length, "Project workspace is not set");

  const origin = await getOriginRemoteUrl(project.workspace);
  if (!origin) {
    return blank(candidates.length, "Project workspace has no origin remote");
  }
  const repo = parseGitHubOrigin(origin);
  if (!repo) {
    return blank(candidates.length, `origin is not a GitHub repository: ${origin}`);
  }

  const lookedUp = await lookup(
    project.workspace,
    repo.owner,
    repo.repo,
    candidates,
  );
  if (!(lookedUp instanceof Map)) return blank(candidates.length, lookedUp.error);

  const matches = new Map<string, string>();
  const facts = new Map<string, PrFacts>();
  const writes: PrReconcileWrite[] = [];
  const tasks = tasksByStory(issues);
  for (const candidate of candidates) {
    const winner = lookedUp.get(candidate.story.id);
    if (!winner) continue;
    matches.set(candidate.story.id, winner.facts.url);
    facts.set(candidate.story.id, winner.facts);
    const fields = outcomePatch(
      candidate.story,
      winner,
      tasks.get(candidate.story.id) ?? [],
    );
    if (!fields) continue;
    await update(candidate.story.id, fields, { refreshPrFacts: false });
    writes.push({ storyId: candidate.story.id, fields });
  }

  return { checked: candidates.length, writes, matches, facts };
}
