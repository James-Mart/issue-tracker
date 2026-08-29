import { bySequence } from "../order.js";
import type { ChangeCommit, ChangeStats, Issue, IssueChange } from "../schemas.js";
import { IssueError } from "./errors.js";
import { runGit } from "./git-read.js";
import { readAll, readIssueOrThrow } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { ancestorChain } from "./subtree.js";

type Story = Extract<Issue, { kind: "story" }>;
type Task = Extract<Issue, { kind: "task" }>;

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
  const patch = await runGitOrCommitUnreachable(
    ["show", "--format=", "--patch", sha],
    workspace,
  );
  const statOut = await runGitOrCommitUnreachable(
    ["show", "--stat", "--format=", sha],
    workspace,
  );

  return {
    state: "loaded",
    commits: [{ sha, subject }],
    patch,
    stats: parseShortstat(statOut),
  };
}

export async function readIssueChange(issueId: string): Promise<IssueChange> {
  const issue = readIssueOrThrow(issueId);
  if (issue.kind !== "task") {
    throw new IssueError(
      "validation",
      `change is not implemented for kind "${issue.kind}"`,
    );
  }

  const chain = ancestorChain(issueId, readAll().issues);
  const project = chain[0]!;
  const workspace = requireProjectWorkspace(project.id);
  return readTaskChange(issue, workspace);
}
