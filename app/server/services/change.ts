import { bySequence } from "../order.js";
import type { ChangeCommit, ChangeStats, Issue, IssueChange } from "../schemas.js";
import { IssueError } from "./errors.js";
import { runGit } from "./git-read.js";
import { readAll, readIssueOrThrow } from "./issues.js";
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

function taskCommit(task: Task): ChangeCommit | undefined {
  if (!task.commitSha || task.noDiff) return undefined;
  return { sha: task.commitSha, subject: "" };
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

function collectFrom(issue: Issue, issues: Issue[], out: ChangeCommit[]): void {
  if (issue.kind === "task") {
    const commit = taskCommit(issue);
    if (commit) out.push(commit);
    return;
  }
  const tasks = issues
    .filter(
      (child): child is Task => child.kind === "task" && isChildOf(child, issue.id),
    )
    .sort(bySequence);
  for (const task of tasks) collectFrom(task, issues, out);
  for (const child of nestedWorkChildren(issue, issues)) {
    collectFrom(child, issues, out);
  }
}

/** Descendant Task shas in implementation order: tasks, then stacked stories, depth-first. */
export function collectDescendantCommits(issueId: string): ChangeCommit[] {
  const issue = readIssueOrThrow(issueId);
  const commits: ChangeCommit[] = [];
  collectFrom(issue, readAll().issues, commits);
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

async function runGitOrCommitUnreachable(
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

function parseShortstat(text: string): ChangeStats {
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
): void {
  if (Buffer.byteLength(patch, "utf8") <= maxPatchBytes()) return;
  throw new IssueError("change-too-large", "patch exceeds render ceiling", {
    stats,
    commitCount,
  });
}

async function assertCommitsContiguous(
  shas: string[],
  workspace: string,
): Promise<void> {
  for (let i = 0; i < shas.length - 1; i++) {
    const from = shas[i]!;
    const to = shas[i + 1]!;
    const count = (
      await runGitOrCommitUnreachable(
        ["rev-list", "--count", `${from}..${to}`],
        workspace,
      )
    ).trim();
    if (count !== "1") {
      throw new IssueError(
        "commits-not-contiguous",
        `commits are not contiguous in history between ${from} and ${to}`,
      );
    }
  }
}

async function readRollupChange(
  issueId: string,
  workspace: string,
): Promise<IssueChange> {
  const commits = collectDescendantCommits(issueId);
  if (commits.length === 0) {
    return { state: "empty", reason: "no-descendant-commits" };
  }

  const shas = commits.map((commit) => commit.sha);
  await assertCommitsContiguous(shas, workspace);

  const first = shas[0]!;
  const last = shas[shas.length - 1]!;
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
    commits.map(async (commit) => ({
      sha: commit.sha,
      subject: (
        await runGitOrCommitUnreachable(
          ["show", "-s", "--format=%s", commit.sha],
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

async function readTaskChange(
  task: Extract<Issue, { kind: "task" }>,
  workspace: string,
): Promise<IssueChange> {
  if (!task.commitSha) {
    return { state: "empty", reason: "no-commit" };
  }
  if (task.noDiff) {
    return { state: "empty", reason: "no-diff" };
  }

  const sha = task.commitSha;
  const subject = (
    await runGitOrCommitUnreachable(
      ["show", "-s", "--format=%s", sha],
      workspace,
    )
  ).trimEnd();
  const statOut = await runGitOrCommitUnreachable(
    ["show", "--shortstat", "--format=", sha],
    workspace,
  );
  const stats = parseShortstat(statOut);
  const patch = await runGitOrCommitUnreachable(
    ["show", "--format=", "--patch", sha],
    workspace,
  );

  assertPatchWithinCeiling(patch, stats, 1);

  return {
    state: "loaded",
    commits: [{ sha, subject }],
    patch,
    stats,
  };
}

function allowedCommitShas(issue: Issue, issueId: string): string[] {
  if (issue.kind === "task") {
    if (!issue.commitSha || issue.noDiff) return [];
    return [issue.commitSha];
  }
  if (issue.kind === "story" || issue.kind === "epic") {
    return collectDescendantCommits(issueId).map((commit) => commit.sha);
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
  const issue = readIssueOrThrow(issueId);
  const chain = ancestorChain(issueId, readAll().issues);
  const project = chain[0]!;
  const workspace = requireProjectWorkspace(project.id);

  const allowed = allowedCommitShas(issue, issueId);
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
  const issue = readIssueOrThrow(issueId);
  const chain = ancestorChain(issueId, readAll().issues);
  const project = chain[0]!;
  const workspace = requireProjectWorkspace(project.id);

  if (issue.kind === "task") {
    return readTaskChange(issue, workspace);
  }
  if (issue.kind === "story" || issue.kind === "epic") {
    return readRollupChange(issueId, workspace);
  }

  throw new IssueError(
    "validation",
    `change is not implemented for kind "${issue.kind}"`,
  );
}
