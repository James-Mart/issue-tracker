import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { Issue, IssuePatch } from "../schemas.js";
import {
  setupLogPathFor,
  worktreePathFor,
} from "../worktree-constants.js";
import { deriveStoryWorktree } from "./derive-worktree.js";
import { IssueError } from "./errors.js";
import { branchExists, currentBranch } from "./git-read.js";
import { runGitWrite } from "./git-write.js";
import { hasActiveImplementingRun } from "./implementing-status.js";
import { list, readAll, update } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { projectContaining } from "./subtree.js";

export { setupLogPathFor, worktreePathFor } from "../worktree-constants.js";

type Story = Extract<Issue, { kind: "story" }>;
type Project = Extract<Issue, { kind: "project" }>;

function requireStory(storyId: string): Story {
  const { issues } = list();
  const story = issues.find((issue) => issue.id === storyId);
  if (!story || story.kind !== "story") {
    throw new IssueError("not_found", `story "${storyId}" does not exist`);
  }
  return story;
}

function projectIdFor(story: Story, issues: Issue[]): string {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  return projectContaining(story, byId);
}

function projectOf(projectId: string, issues: Issue[]): Project {
  const project = issues.find((issue) => issue.id === projectId);
  if (!project || project.kind !== "project") {
    throw new IssueError("not_found", `project "${projectId}" does not exist`);
  }
  return project;
}

function refuseExistingWorktree(story: Story): void {
  if (story.worktreePath && existsSync(story.worktreePath)) {
    throw new IssueError(
      "validation",
      `Story "${story.id}" already has a worktree at ${story.worktreePath}`,
    );
  }
}

export const CREATE_HAS_BRANCH_ERROR = (storyId: string) =>
  `worktree create refuses Story "${storyId}" that already has branchName`;

export const CREATE_NO_MERGE_BASE_ERROR = (storyId: string, parentId: string) =>
  `worktree create refuses Story "${storyId}" stacked on Story "${parentId}" which has no branch yet`;

export const ATTACH_NO_BRANCH_ERROR = (storyId: string) =>
  `worktree attach requires branchName on Story "${storyId}"`;

export const ATTACH_BRANCH_MISSING_ERROR = (storyId: string, branchName: string) =>
  `worktree attach refuses Story "${storyId}": branch "${branchName}" does not exist in the Project repository`;

export const ATTACH_BRANCH_CHECKED_OUT_ERROR = (storyId: string, branchName: string) =>
  `worktree attach refuses Story "${storyId}": branch "${branchName}" is checked out in the Project workspace`;

export const SETUP_NO_COMMAND_ERROR = (storyId: string) =>
  `worktree setup requires setupCommand on the Project for Story "${storyId}"`;

export const SETUP_NO_WORKTREE_ERROR = (storyId: string) =>
  `worktree setup requires an existing worktree for Story "${storyId}"`;

export const SETUP_FAILED_ERROR = (storyId: string, code: number, logPath: string) =>
  `setup command failed for Story "${storyId}" (exit ${code}); see ${logPath}`;

export const REMOVE_NO_WORKTREE_ERROR = (storyId: string) =>
  `worktree remove requires an existing worktree for Story "${storyId}"`;

export const REMOVE_ACTIVE_IMPLEMENTING_ERROR = (storyId: string) =>
  `worktree remove refuses Story "${storyId}" while an implementing session is active`;

export const REMOVE_UNSAFE_ERROR = (
  storyId: string,
  uncommittedCount: number,
  atRiskCommitCount: number,
) =>
  `worktree remove refuses Story "${storyId}": ${uncommittedCount} uncommitted change(s), ${atRiskCommitCount} at-risk commit(s)`;

async function addWorktree(
  workspace: string,
  args: string[],
): Promise<void> {
  await runGitWrite(["worktree", "add", ...args], workspace);
}

function runSetupCommand(
  cwd: string,
  command: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn("sh", ["-c", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer | string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      output += chunk;
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(new IssueError("validation", err.message));
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

async function recordSetupFailure(
  storyId: string,
  projectId: string,
  output: string,
  code: number,
  extra: IssuePatch,
): Promise<never> {
  const logPath = setupLogPathFor(projectId, storyId);
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, output);
  await update(storyId, { ...extra, worktreeSetupFailed: true });
  throw new IssueError("conflict", SETUP_FAILED_ERROR(storyId, code, logPath), {
    setupLogPath: logPath,
  });
}

async function applySetupCommand(
  storyId: string,
  projectId: string,
  worktreePath: string,
  setupCommand: string | undefined,
  extra: IssuePatch,
): Promise<void> {
  if (!setupCommand) {
    await update(storyId, { ...extra, worktreeSetupFailed: false });
    return;
  }
  const { code, output } = await runSetupCommand(worktreePath, setupCommand);
  if (code === 0) {
    await update(storyId, { ...extra, worktreeSetupFailed: false });
    return;
  }
  await recordSetupFailure(storyId, projectId, output, code, extra);
}

export async function createStoryWorktree(storyId: string): Promise<string> {
  const { issues, derived } = list();
  const story = requireStory(storyId);
  const projectId = projectIdFor(story, issues);
  const workspace = requireProjectWorkspace(projectId);
  const path = worktreePathFor(projectId, storyId);

  if (story.branchName) {
    throw new IssueError("validation", CREATE_HAS_BRANCH_ERROR(storyId));
  }

  refuseExistingWorktree(story);

  const mergeBase = derived[storyId]?.mergeBase;
  if (!mergeBase) {
    const parentId = story.stackedOn;
    if (!parentId) {
      throw new IssueError(
        "validation",
        `worktree create requires mergeBase on Story "${storyId}"`,
      );
    }
    await update(storyId, { worktreeBlockedReason: "parent-branch" });
    throw new IssueError(
      "validation",
      CREATE_NO_MERGE_BASE_ERROR(storyId, parentId),
    );
  }

  await addWorktree(workspace, ["-b", storyId, path, mergeBase]);
  await applySetupCommand(storyId, projectId, path, projectOf(projectId, issues).setupCommand, {
    worktreePath: path,
    worktreeBlockedReason: null,
  });
  return path;
}

export async function attachStoryWorktree(storyId: string): Promise<string> {
  const { issues } = list();
  const story = requireStory(storyId);
  const projectId = projectIdFor(story, issues);
  const workspace = requireProjectWorkspace(projectId);
  const path = worktreePathFor(projectId, storyId);

  if (!story.branchName) {
    throw new IssueError("validation", ATTACH_NO_BRANCH_ERROR(storyId));
  }

  refuseExistingWorktree(story);

  if (!(await branchExists(workspace, story.branchName))) {
    throw new IssueError(
      "validation",
      ATTACH_BRANCH_MISSING_ERROR(storyId, story.branchName),
    );
  }

  const checkedOut = await currentBranch(workspace);
  if (checkedOut === story.branchName) {
    throw new IssueError(
      "validation",
      ATTACH_BRANCH_CHECKED_OUT_ERROR(storyId, story.branchName),
    );
  }

  await addWorktree(workspace, [path, story.branchName]);
  await applySetupCommand(storyId, projectId, path, projectOf(projectId, issues).setupCommand, {
    worktreePath: path,
    worktreeBlockedReason: null,
  });
  return path;
}

export type AttemptedWorktreeRemoval =
  | { outcome: "removed"; path: string }
  | { outcome: "absent" }
  | { outcome: "retained"; path: string };

export async function attemptStoryWorktreeRemoval(
  storyId: string,
): Promise<AttemptedWorktreeRemoval> {
  let path: string | undefined;
  try {
    const story = readAll().issues.find((issue) => issue.id === storyId);
    if (!story || story.kind !== "story") return { outcome: "absent" };
    path = story.worktreePath;
    if (!path || !existsSync(path)) return { outcome: "absent" };
    await removeStoryWorktree(storyId);
    return { outcome: "removed", path };
  } catch (err) {
    // Automatic callers never pass --discard; a refusal leaves the checkout
    // and must not fail merge, archive, or delete.
    if (!(err instanceof IssueError)) throw err;
    if (path && existsSync(path)) return { outcome: "retained", path };
    return { outcome: "absent" };
  }
}

export function storyIdsForLifecycleRemoval(
  existing: Issue,
  next: Issue,
  archivedCascadePatches: readonly { id: string; archived: boolean }[],
  issues: Issue[],
): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  if (existing.kind === "story" && next.kind === "story") {
    if (!existing.merged && next.merged) add(existing.id);
    if (!existing.archived && next.archived) add(existing.id);
  }
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  for (const patch of archivedCascadePatches) {
    if (!patch.archived) continue;
    if (byId.get(patch.id)?.kind === "story") add(patch.id);
  }
  return ids;
}

export async function removeStoryWorktree(
  storyId: string,
  options: { discard?: boolean } = {},
): Promise<string> {
  const { issues, derived } = list();
  const story = requireStory(storyId);
  const projectId = projectIdFor(story, issues);
  const workspace = requireProjectWorkspace(projectId);
  const path = story.worktreePath;

  if (!path || !existsSync(path)) {
    throw new IssueError("validation", REMOVE_NO_WORKTREE_ERROR(storyId));
  }

  if (hasActiveImplementingRun(storyId)) {
    throw new IssueError("conflict", REMOVE_ACTIVE_IMPLEMENTING_ERROR(storyId));
  }

  const worktree =
    derived[storyId]?.worktree ?? deriveStoryWorktree(story, issues);
  const uncommittedCount = worktree.uncommittedCount;
  const atRiskCommitCount = worktree.atRiskCommitCount;

  if (
    !options.discard &&
    (uncommittedCount > 0 || atRiskCommitCount > 0)
  ) {
    throw new IssueError(
      "conflict",
      REMOVE_UNSAFE_ERROR(storyId, uncommittedCount, atRiskCommitCount),
    );
  }

  const args = [
    "worktree",
    "remove",
    ...(options.discard ? ["--force"] : []),
    path,
  ];
  await runGitWrite(args, workspace);
  await update(storyId, { worktreePath: null });
  return path;
}

export async function setupStoryWorktree(storyId: string): Promise<string> {
  const { issues } = list();
  const story = requireStory(storyId);
  const projectId = projectIdFor(story, issues);
  const setupCommand = projectOf(projectId, issues).setupCommand;
  if (!setupCommand) {
    throw new IssueError("validation", SETUP_NO_COMMAND_ERROR(storyId));
  }
  const path = story.worktreePath ?? worktreePathFor(projectId, storyId);
  if (!existsSync(path)) {
    throw new IssueError("validation", SETUP_NO_WORKTREE_ERROR(storyId));
  }
  await applySetupCommand(storyId, projectId, path, setupCommand, {});
  return path;
}
