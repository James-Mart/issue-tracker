import { existsSync } from "fs";
import { join } from "path";
import type { Issue } from "../schemas.js";
import { WORKTREE_ROOT } from "../worktree-constants.js";
import { IssueError } from "./errors.js";
import { branchExists, currentBranch } from "./git-read.js";
import { runGitWrite } from "./git-write.js";
import { list, update } from "./issues.js";
import { projectContaining } from "./subtree.js";

type Story = Extract<Issue, { kind: "story" }>;

export function worktreePathFor(projectId: string, storyId: string): string {
  return join(WORKTREE_ROOT, projectId, storyId);
}

function requireStory(storyId: string): Story {
  const { issues } = list();
  const story = issues.find((issue) => issue.id === storyId);
  if (!story || story.kind !== "story") {
    throw new IssueError("not_found", `story "${storyId}" does not exist`);
  }
  return story;
}

function requireProjectWorkspace(story: Story, issues: Issue[]): string {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const projectId = projectContaining(story, byId);
  const project = byId.get(projectId);
  if (!project || project.kind !== "project" || !project.workspace) {
    throw new IssueError(
      "validation",
      `Project workspace is not set`,
    );
  }
  return project.workspace;
}

function projectIdFor(story: Story, issues: Issue[]): string {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  return projectContaining(story, byId);
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

async function addWorktree(
  workspace: string,
  args: string[],
): Promise<void> {
  await runGitWrite(["worktree", "add", ...args], workspace);
}

export async function createStoryWorktree(storyId: string): Promise<string> {
  const { issues, derived } = list();
  const story = requireStory(storyId);
  const workspace = requireProjectWorkspace(story, issues);
  const projectId = projectIdFor(story, issues);
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
  await update(storyId, { worktreePath: path, worktreeBlockedReason: null });
  return path;
}

export async function attachStoryWorktree(storyId: string): Promise<string> {
  const { issues } = list();
  const story = requireStory(storyId);
  const workspace = requireProjectWorkspace(story, issues);
  const projectId = projectIdFor(story, issues);
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
  await update(storyId, { worktreePath: path, worktreeBlockedReason: null });
  return path;
}
