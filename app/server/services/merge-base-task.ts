import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import type { Issue } from "../schemas.js";
import type { StoryApplyDoc } from "./apply-schema.js";
import { appendTasks, type AppendSummary } from "./append.js";
import { IssueError } from "./errors.js";
import { list } from "./issues.js";
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

export const MERGE_BASE_TASK_TITLE = "Update from merge base";

export const UPDATE_FROM_MERGE_BASE_NO_BRANCH_ERROR = (storyId: string) =>
  `update-from-merge-base requires branchName on Story "${storyId}"`;

export const UPDATE_FROM_MERGE_BASE_NO_MERGE_BASE_ERROR = (storyId: string) =>
  `update-from-merge-base requires mergeBase on Story "${storyId}"`;

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

  const description = renderMergeBaseTaskDescription({
    branchName: detail.branchName,
    mergeBase,
  });
  const doc = mergeBaseAppendDoc(detail, issues, description);
  return appendTasks({ storyId, doc });
}
