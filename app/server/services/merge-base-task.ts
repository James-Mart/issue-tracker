import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { UPDATE_FROM_MERGE_BASE_TITLE } from "../issue-constants.js";
import type { Issue } from "../schemas.js";
import type { StoryApplyDoc } from "./apply-schema.js";
import { appendTasks, type AppendSummary } from "./append.js";
import { IssueError } from "./errors.js";
import { refIsAncestor } from "./git-read.js";
import { list } from "./issues.js";
import { resolveMergeBaseRef } from "./resolve-merge-base-ref.js";
import { uniqueSlug } from "./slug.js";
import { ancestorChain } from "./subtree.js";

const servicesDir = fileURLToPath(new URL(".", import.meta.url));
const templatePath = join(
  servicesDir,
  "..",
  "templates",
  "update-from-merge-base.md",
);

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/;

function requireRef(name: string, value: string): void {
  if (value) return;
  throw new IssueError(
    "validation",
    `merge-base task description requires ${name}`,
  );
}

export function renderMergeBaseTaskDescription({
  branchName,
  mergeBase,
}: {
  branchName: string;
  mergeBase: string;
}): string {
  requireRef("branchName", branchName);
  requireRef("mergeBase", mergeBase);

  const template = readFileSync(templatePath, "utf8");
  const rendered = template
    .replaceAll("{{branchName}}", branchName)
    .replaceAll("{{mergeBase}}", mergeBase);

  const leftover = rendered.match(PLACEHOLDER_PATTERN);
  if (leftover) {
    throw new IssueError(
      "validation",
      `unsubstituted placeholder in merge-base task template: ${leftover[0]}`,
    );
  }

  return rendered;
}

export const MERGE_BASE_TASK_TITLE = UPDATE_FROM_MERGE_BASE_TITLE;

export const UPDATE_FROM_MERGE_BASE_NO_BRANCH_ERROR = (storyId: string) =>
  `update-from-merge-base requires branchName on Story "${storyId}"`;

export const UPDATE_FROM_MERGE_BASE_NO_MERGE_BASE_ERROR = (storyId: string) =>
  `update-from-merge-base requires mergeBase on Story "${storyId}"`;

export const UPDATE_FROM_MERGE_BASE_OPEN_TASK_ERROR = (storyId: string) =>
  `update-from-merge-base already has an open task on Story "${storyId}"`;

export const BEHIND_MERGE_BASE_NO_BRANCH_ERROR = (storyId: string) =>
  `behindMergeBase requires branchName on Story "${storyId}"`;

export const BEHIND_MERGE_BASE_NO_MERGE_BASE_ERROR = (storyId: string) =>
  `behindMergeBase requires mergeBase on Story "${storyId}"`;

export const BEHIND_MERGE_BASE_NO_WORKTREE_ERROR = (storyId: string) =>
  `behindMergeBase requires a readable worktree on Story "${storyId}"`;

function hasOpenMergeBaseTask(storyId: string, issues: Issue[]): boolean {
  return issues.some(
    (issue) =>
      issue.kind === "task" &&
      issue.partOf === storyId &&
      issue.title === MERGE_BASE_TASK_TITLE &&
      issue.status !== "done",
  );
}

/** Derived on read from the Story worktree. Not stored. */
export async function storyBehindMergeBase(storyId: string): Promise<boolean> {
  const { issues, derived } = list();
  const detail = issues.find((issue) => issue.id === storyId);
  if (!detail || detail.kind !== "story") {
    throw new IssueError("not_found", `story "${storyId}" does not exist`);
  }
  if (!detail.branchName) {
    throw new IssueError("validation", BEHIND_MERGE_BASE_NO_BRANCH_ERROR(storyId));
  }
  const mergeBase = derived[storyId]?.mergeBase;
  if (!mergeBase) {
    throw new IssueError(
      "validation",
      BEHIND_MERGE_BASE_NO_MERGE_BASE_ERROR(storyId),
    );
  }
  const worktree = detail.worktreePath;
  if (!worktree || !existsSync(worktree)) {
    throw new IssueError(
      "validation",
      BEHIND_MERGE_BASE_NO_WORKTREE_ERROR(storyId),
    );
  }
  const mergeBaseRef = await resolveMergeBaseRef(worktree, mergeBase);
  return !refIsAncestor(worktree, mergeBaseRef, detail.branchName);
}

function mergeBaseAppendDoc(
  story: Extract<Issue, { kind: "story" }>,
  issues: Issue[],
  description: string,
): StoryApplyDoc {
  const chain = ancestorChain(story.id, issues);
  const project = chain[0];

  const epic =
    story.partOf !== project.id
      ? chain.find((issue) => issue.id === story.partOf && issue.kind === "epic")
      : undefined;

  return {
    project: project.id,
    ...(epic ? { epic: epic.id } : {}),
    story: {
      id: story.id,
      title: story.title,
      children: [
        {
          kind: "task",
          id: uniqueSlug(
            MERGE_BASE_TASK_TITLE,
            issues.map((issue) => issue.id),
          ),
          title: MERGE_BASE_TASK_TITLE,
          description,
        },
      ],
    },
  };
}

export function appendUpdateFromMergeBase(storyId: string): Promise<AppendSummary> {
  const { issues, derived } = list();
  const detail = issues.find((issue) => issue.id === storyId);
  if (!detail || detail.kind !== "story") {
    throw new IssueError("not_found", `story "${storyId}" does not exist`);
  }
  if (!detail.branchName) {
    throw new IssueError(
      "validation",
      UPDATE_FROM_MERGE_BASE_NO_BRANCH_ERROR(storyId),
    );
  }

  const mergeBase = derived[storyId]?.mergeBase;
  if (!mergeBase) {
    throw new IssueError(
      "validation",
      UPDATE_FROM_MERGE_BASE_NO_MERGE_BASE_ERROR(storyId),
    );
  }
  if (hasOpenMergeBaseTask(storyId, issues)) {
    throw new IssueError(
      "validation",
      UPDATE_FROM_MERGE_BASE_OPEN_TASK_ERROR(storyId),
    );
  }

  const description = renderMergeBaseTaskDescription({
    branchName: detail.branchName,
    mergeBase,
  });
  const doc = mergeBaseAppendDoc(detail, issues, description);
  return appendTasks({ storyId, doc });
}
