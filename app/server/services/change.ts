import { cachedPromise } from "@/lib/cached-promise";
import { bySequence } from "../order.js";
import type { ChangeCommit, ChangeStats, Issue, IssueChange } from "../schemas.js";
import { derive } from "./derive.js";
import { IssueError } from "./errors.js";
import { runGit } from "./git-read.js";
import { resolveMergeBaseRef } from "./resolve-merge-base-ref.js";
import { readAll, readIssueOrThrow, readSnapshot } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { ancestorChain } from "./subtree.js";

type Story = Extract<Issue, { kind: "story" }>;
type Task = Extract<Issue, { kind: "task" }>;

/** Keep server responses within what @pierre/diffs can render in the browser. */
export function maxPatchBytes(): number {
  const raw = process.env.ISSUE_TRACKER_MAX_PATCH_BYTES;
  if (raw != null && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 2 * 1024 * 1024;
}

function isChildOf(issue: Issue, parentId: string): boolean {
  return issue.kind !== "project" && issue.partOf === parentId;
}

function taskCommitsForCollect(task: Task): ChangeCommit[] {
  if (task.noDiff || task.commits.length === 0) return [];
  return task.commits.map((sha) => ({ sha, subject: "" }));
}

/** Stories / Epics nested under `parent` for the implementation-order walk. */
function nestedWorkChildren(parent: Issue, issues: Issue[]): Issue[] {
  if (parent.kind === "story") {
    return issues
      .filter(
        (child): child is Story =>
          child.kind === "story" && child.stackedOn === parent.id,
      )
      .sort(bySequence);
  }
  const siblingStories = issues.filter(
    (child): child is Story => child.kind === "story" && isChildOf(child, parent.id),
  );
  const siblingIds = new Set(siblingStories.map((story) => story.id));
  return issues
    .filter((child) => {
      if (!isChildOf(child, parent.id)) return false;
      if (child.kind === "epic") return true;
      if (child.kind !== "story") return false;
      return !child.stackedOn || !siblingIds.has(child.stackedOn);
    })
    .sort(bySequence);
}

function collectOwnTaskCommits(
  parentId: string,
  issues: Issue[],
  out: ChangeCommit[],
): void {
  const tasks = issues
    .filter(
      (child): child is Task => child.kind === "task" && isChildOf(child, parentId),
    )
    .sort(bySequence);
  for (const task of tasks) {
    out.push(...taskCommitsForCollect(task));
  }
}

function collectFrom(issue: Issue, issues: Issue[], out: ChangeCommit[]): void {
  collectOwnTaskCommits(issue.id, issues, out);
  for (const child of nestedWorkChildren(issue, issues)) {
    collectFrom(child, issues, out);
  }
}

/**
 * Task shas in implementation order. A Story yields only its own Tasks;
 * an Epic walks child Stories (including stacked) depth-first.
 * Pass `issues` to walk an already-loaded snapshot instead of reading the store again.
 */
export function collectDescendantCommits(
  issueId: string,
  issues?: Issue[],
): ChangeCommit[] {
  const issue = issues
    ? issues.find((item) => item.id === issueId)
    : readIssueOrThrow(issueId);
  if (!issue) {
    throw new IssueError("not_found", `unknown issue "${issueId}"`);
  }
  const all = issues ?? readAll().issues;
  const commits: ChangeCommit[] = [];
  if (issue.kind === "story") {
    collectOwnTaskCommits(issue.id, all, commits);
  } else {
    collectFrom(issue, all, commits);
  }
  return commits;
}

function isCommitUnreachableMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("bad object") ||
    lower.includes("unknown revision") ||
    lower.includes("invalid object name")
  );
}

export async function runGitOrCommitUnreachable(
  args: string[],
  workspace: string,
): Promise<string> {
  try {
    return await runGit(args, workspace);
  } catch (err) {
    if (err instanceof IssueError && err.code === "git-failed") {
      if (isCommitUnreachableMessage(err.message)) {
        throw new IssueError("commit-unreachable", err.message);
      }
    }
    throw err;
  }
}

export function parseShortstat(text: string): ChangeStats {
  const filesMatch = text.match(/(\d+) files? changed/);
  const insMatch = text.match(/(\d+) insertion/);
  const delMatch = text.match(/(\d+) deletion/);
  return {
    filesChanged: filesMatch ? Number(filesMatch[1]) : 0,
    insertions: insMatch ? Number(insMatch[1]) : 0,
    deletions: delMatch ? Number(delMatch[1]) : 0,
  };
}

function assertPatchWithinCeiling(
  patch: string,
  stats: ChangeStats,
  commitCount: number,
  mergeBaseRef?: string,
): void {
  if (Buffer.byteLength(patch, "utf8") <= maxPatchBytes()) return;
  throw new IssueError("change-too-large", "patch exceeds render ceiling", {
    stats,
    commitCount,
    ...(mergeBaseRef ? { mergeBaseRef } : {}),
  });
}

async function assertCommitsContiguous(
  shas: string[],
  workspace: string,
): Promise<void> {
  if (shas.length <= 1) return;

  const first = shas[0]!;
  const last = shas.at(-1)!;
  const between = (
    await runGitOrCommitUnreachable(
      ["rev-list", "--first-parent", "--reverse", `${first}..${last}`],
      workspace,
    )
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  for (let i = 1; i < shas.length; i++) {
    if (between[i - 1] !== shas[i]) {
      throw new IssueError(
        "commits-not-contiguous",
        `commits are not contiguous in history between ${shas[i - 1]!} and ${shas[i]!}`,
      );
    }
  }
  if (between.length !== shas.length - 1) {
    throw new IssueError(
      "commits-not-contiguous",
      `commits are not contiguous in history between ${shas.at(-2)!} and ${shas.at(-1)!}`,
    );
  }
}

export type StoryChangePreparation =
  | { state: "empty"; reason: "no-merge-base" }
  | { state: "empty"; reason: "no-descendant-commits"; mergeBase: string }
  | {
      state: "ready";
      mergeBase: string;
      mergeBaseRef: string;
      shas: string[];
      tip: string;
      range: string;
    };

const storyChangeCache = new Map<string, Promise<StoryChangePreparation>>();
let storyChangeCacheVersion = -1;

function storyChangeCacheFor(version: number): Map<string, Promise<StoryChangePreparation>> {
  if (storyChangeCacheVersion !== version) {
    storyChangeCache.clear();
    storyChangeCacheVersion = version;
  }
  return storyChangeCache;
}

// readAll() copies the snapshot array and keeps the same frozen issue objects.
function sharesSnapshotIssues(graph: readonly Issue[], live: readonly Issue[]): boolean {
  if (graph.length !== live.length) return false;
  for (let i = 0; i < graph.length; i++) {
    if (graph[i] !== live[i]) return false;
  }
  return true;
}

function storyCommitShas(storyId: string, graph: readonly Issue[]): string[] {
  const story = graph.find((item) => item.id === storyId);
  if (!story) return [];
  return issueChangeCommitShas(story, graph as Issue[]);
}

/** Last task-commit sha for the story, or "" when it has none. */
export function storyTipSha(storyId: string, issues: readonly Issue[]): string {
  return storyCommitShas(storyId, issues).at(-1) ?? "";
}

/** Strong ETag for GET /commits: store snapshot version and the story tip. */
export function storyCommitsEtag(version: number, tip: string): string {
  return `"${version}:${tip}"`;
}

async function computeStoryChange(
  storyId: string,
  workspace: string,
  graph: readonly Issue[],
  shas: string[],
): Promise<StoryChangePreparation> {
  const mergeBase = derive(graph as Issue[]).byId[storyId]?.mergeBase;
  if (!mergeBase) {
    return { state: "empty", reason: "no-merge-base" };
  }
  if (shas.length === 0) {
    return { state: "empty", reason: "no-descendant-commits", mergeBase };
  }

  await assertCommitsContiguous(shas, workspace);
  const tip = shas.at(-1)!;
  const mergeBaseRef = await resolveMergeBaseRef(workspace, mergeBase);
  return {
    state: "ready",
    mergeBase,
    mergeBaseRef,
    shas,
    tip,
    range: `${mergeBaseRef}...${tip}`,
  };
}

/**
 * Merge base through the tip of the Story's Task commits, same span as `readIssueChange`.
 * Memoized on story, that tip, and the store snapshot version. A repeat call resolves
 * the tip from the story's commits and reuses the preparation.
 */
export async function prepareStoryChange(
  storyId: string,
  workspace: string,
  issues?: Issue[],
): Promise<StoryChangePreparation> {
  const snapshot = readSnapshot();
  // A list from an earlier snapshot must not be stored under the current version.
  if (issues !== undefined && !sharesSnapshotIssues(issues, snapshot.issues)) {
    return computeStoryChange(
      storyId,
      workspace,
      issues,
      storyCommitShas(storyId, issues),
    );
  }

  const graph = issues ?? snapshot.issues;
  const shas = storyCommitShas(storyId, graph);
  const cache = storyChangeCacheFor(snapshot.version);
  return cachedPromise(cache, `${storyId}\0${shas.at(-1) ?? ""}`, () =>
    computeStoryChange(storyId, workspace, graph, shas),
  );
}

export function requireMergeBase(
  storyId: string,
  prepared: StoryChangePreparation,
): Exclude<StoryChangePreparation, { reason: "no-merge-base" }> {
  if (prepared.state === "empty" && prepared.reason === "no-merge-base") {
    throw new IssueError("validation", `story "${storyId}" has no merge base`);
  }
  return prepared;
}

async function readStoryChange(
  issueId: string,
  workspace: string,
  issues: Issue[],
): Promise<IssueChange> {
  const prepared = await prepareStoryChange(issueId, workspace, issues);
  if (prepared.state === "empty") {
    return { state: "empty", reason: prepared.reason };
  }

  const { range, mergeBaseRef, shas } = prepared;
  const statOut = await runGitOrCommitUnreachable(
    ["diff", "--shortstat", range],
    workspace,
  );
  const stats = parseShortstat(statOut);
  const patch = await runGitOrCommitUnreachable(["diff", range], workspace);

  const withSubjects = await Promise.all(
    shas.map(async (sha) => ({
      sha,
      subject: (
        await runGitOrCommitUnreachable(
          ["show", "-s", "--format=%s", sha],
          workspace,
        )
      ).trimEnd(),
    })),
  );

  assertPatchWithinCeiling(patch, stats, withSubjects.length, mergeBaseRef);

  return {
    state: "loaded",
    commits: withSubjects,
    patch,
    stats,
  };
}

async function readTaskChange(
  task: Extract<Issue, { kind: "task" }>,
  workspace: string,
): Promise<IssueChange> {
  if (task.commits.length === 0) {
    return { state: "empty", reason: "no-commit" };
  }
  if (task.noDiff) {
    return { state: "empty", reason: "no-diff" };
  }

  const first = task.commits[0]!;
  const last = task.commits[task.commits.length - 1]!;
  const base = (
    await runGitOrCommitUnreachable(["rev-parse", `${first}^`], workspace)
  ).trim();
  const range = `${base}..${last}`;
  const statOut = await runGitOrCommitUnreachable(
    ["diff", "--shortstat", range],
    workspace,
  );
  const stats = parseShortstat(statOut);
  const patch = await runGitOrCommitUnreachable(["diff", range], workspace);

  const withSubjects = await Promise.all(
    task.commits.map(async (sha) => ({
      sha,
      subject: (
        await runGitOrCommitUnreachable(
          ["show", "-s", "--format=%s", sha],
          workspace,
        )
      ).trimEnd(),
    })),
  );

  assertPatchWithinCeiling(patch, stats, withSubjects.length);

  return {
    state: "loaded",
    commits: withSubjects,
    patch,
    stats,
  };
}

const EPIC_CHANGE_UNSUPPORTED =
  "Epic diffs are not supported; use Story or Task detail instead";

function assertChangeSupported(issue: Issue): void {
  if (issue.kind === "epic") {
    throw new IssueError("validation", EPIC_CHANGE_UNSUPPORTED);
  }
}

/**
 * Commit shas of this issue's change, in implementation order.
 * Empty when the change is empty (no commits, noDiff, or a kind with no range).
 */
export function issueChangeCommitShas(issue: Issue, issues?: Issue[]): string[] {
  if (issue.kind === "task") {
    if (issue.commits.length === 0 || issue.noDiff) return [];
    return issue.commits;
  }
  if (issue.kind === "story") {
    return collectDescendantCommits(issue.id, issues).map((commit) => commit.sha);
  }
  return [];
}

function allowedCommitShas(issue: Issue, issues: Issue[]): string[] {
  assertChangeSupported(issue);
  const shas = issueChangeCommitShas(issue, issues);
  if (issue.kind === "task") {
    const sha = shas.at(-1);
    return sha ? [sha] : [];
  }
  if (issue.kind === "story") {
    return shas;
  }
  throw new IssueError(
    "validation",
    `change is not implemented for kind "${issue.kind}"`,
  );
}

function isPathMissingAtCommitMessage(message: string): boolean {
  return message.toLowerCase().includes("does not exist in");
}

export async function readIssueChangeFile(
  issueId: string,
  sha: string,
  path: string,
): Promise<{ contents: string }> {
  const issues = readAll().issues;
  const issue = issues.find((item) => item.id === issueId) ?? readIssueOrThrow(issueId);
  const chain = ancestorChain(issueId, issues);
  const project = chain[0]!;
  const workspace = requireProjectWorkspace(project.id);

  const allowed = allowedCommitShas(issue, issues);
  if (!allowed.includes(sha)) {
    throw new IssueError(
      "validation",
      `sha "${sha}" is not one of this issue's commits`,
    );
  }

  try {
    const contents = await runGitOrCommitUnreachable(
      ["show", `${sha}:${path}`],
      workspace,
    );
    return { contents };
  } catch (err) {
    if (err instanceof IssueError && err.code === "git-failed") {
      if (isPathMissingAtCommitMessage(err.message)) {
        throw new IssueError("not_found", err.message);
      }
    }
    throw err;
  }
}

export async function readIssueChange(issueId: string): Promise<IssueChange> {
  const issues = readAll().issues;
  const issue = issues.find((item) => item.id === issueId) ?? readIssueOrThrow(issueId);
  assertChangeSupported(issue);
  const chain = ancestorChain(issueId, issues);
  const project = chain[0]!;
  const workspace = requireProjectWorkspace(project.id);

  if (issue.kind === "task") {
    return readTaskChange(issue, workspace);
  }
  if (issue.kind === "story") {
    return readStoryChange(issueId, workspace, issues);
  }

  throw new IssueError(
    "validation",
    `change is not implemented for kind "${issue.kind}"`,
  );
}
