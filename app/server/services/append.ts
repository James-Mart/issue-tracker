import { parseIssue, type Issue } from "../schemas.js";
import { TASK_RUNTIME_OPTIONAL_KEYS } from "../fields.js";
import { nextSiblingOrder } from "../order.js";
import type { ApplyDoc, DesiredIssue } from "./apply-schema.js";
import { flattenApplyDoc, isStoryDoc } from "./apply-schema.js";
import { ancestorIsArchived } from "./archived-visibility.js";
import { IssueError } from "./errors.js";
import { checkIntegrity } from "./integrity.js";
import {
  commitIssueBatch,
  ensureMigrations,
  onDiskHasUnknownKeys,
  readAll,
  readDescription,
  serialize,
  type IssueWrite,
} from "./issues.js";
import { APPEND_TO_MERGED_ERROR } from "./patch.js";

export interface AppendSummary {
  created: string[];
  updated: string[];
}

function storyIdMismatchError(docStoryId: string, storyId: string): string {
  return `story.id "${docStoryId}" does not match append target "${storyId}"`;
}

const STACKED_STORY_APPEND_ERROR =
  "append refuses kind: story children; a stacked Story is not an append";

const STORY_FORM_REQUIRED_ERROR = "append requires a story-form apply doc";

function buildTask(
  desired: DesiredIssue,
  existing: Extract<Issue, { kind: "task" }> | undefined,
  now: string,
  order: number,
  onDisk: Issue[],
): Issue {
  const draft: Record<string, unknown> = {
    id: desired.id,
    kind: "task",
    title: desired.title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    partOf: desired.partOf,
    order,
  };

  if (existing) {
    draft.needsAttention = existing.needsAttention;
    draft.attentionReason = existing.attentionReason;
    if (existing.assignee !== undefined) draft.assignee = existing.assignee;
    draft.archived = existing.archived;
    draft.status = existing.status;
    for (const key of TASK_RUNTIME_OPTIONAL_KEYS) {
      if (existing[key] !== undefined) draft[key] = existing[key];
    }
  } else {
    draft.appended = true;
    if (ancestorIsArchived(desired.partOf, onDisk)) {
      draft.archived = true;
    }
  }

  const parsed = parseIssue(draft);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  return parsed.issue;
}

// Add or restated-upsert Tasks on an existing Story. Unlike `apply`, omitted
// Tasks are left alone, new Tasks take `order` after the current maximum, and
// each created Task is marked `appended: true`.
export function appendTasks({
  storyId,
  doc,
}: {
  storyId: string;
  doc: ApplyDoc;
}): Promise<AppendSummary> {
  return serialize(() => {
    ensureMigrations();
    if (!isStoryDoc(doc)) {
      throw new IssueError("validation", STORY_FORM_REQUIRED_ERROR);
    }
    if (doc.story.id !== storyId) {
      throw new IssueError(
        "validation",
        storyIdMismatchError(doc.story.id, storyId),
      );
    }

    const now = new Date().toISOString();
    const desired = flattenApplyDoc(doc);
    if (desired.some((node) => node.kind === "story" && node.id !== storyId)) {
      throw new IssueError("validation", STACKED_STORY_APPEND_ERROR);
    }

    const { issues } = readAll();
    const onDiskById = new Map(issues.map((issue) => [issue.id, issue]));
    const target = onDiskById.get(storyId);
    if (!target) {
      throw new IssueError("not_found", `story "${storyId}" does not exist`);
    }
    if (target.kind !== "story") {
      throw new IssueError(
        "validation",
        `"${storyId}" must be a story, not a ${target.kind}`,
      );
    }
    if (target.merged) {
      throw new IssueError("validation", APPEND_TO_MERGED_ERROR(storyId));
    }

    const created: string[] = [];
    const updated: string[] = [];
    const prospective = new Map(issues.map((issue) => [issue.id, issue]));
    const writes: IssueWrite[] = [];
    let nextOrder = nextSiblingOrder(issues, "task", storyId, undefined);

    for (const node of desired) {
      if (node.kind !== "task") continue;

      const existing = onDiskById.get(node.id);
      if (existing && (existing.kind !== "task" || existing.partOf !== storyId)) {
        throw new IssueError(
          "validation",
          `cannot append "${node.id}": id already exists outside the target story "${storyId}"`,
        );
      }

      const prior = existing && existing.kind === "task" ? existing : undefined;
      const order = prior ? prior.order : nextOrder++;
      const next = buildTask(node, prior, now, order, issues);

      if (!prior) {
        prospective.set(next.id, next);
        writes.push({
          issue: next,
          description: node.description ?? `# ${node.title}\n`,
        });
        created.push(next.id);
        continue;
      }

      const probe: Issue = { ...next, updatedAt: prior.updatedAt };
      const jsonChanged = JSON.stringify(probe) !== JSON.stringify(prior);
      const descChanged =
        node.description !== undefined &&
        node.description !== readDescription(node.id);
      const staleOnDisk = onDiskHasUnknownKeys(prior);

      if (!jsonChanged && !descChanged && !staleOnDisk) {
        prospective.set(prior.id, prior);
        continue;
      }
      const rewritten = !jsonChanged && !descChanged ? probe : next;
      prospective.set(rewritten.id, rewritten);
      writes.push({
        issue: rewritten,
        description: descChanged ? node.description : undefined,
      });
      updated.push(next.id);
    }

    const problems = checkIntegrity([...prospective.values()]);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((p) => p.message).join("; "),
      );
    }

    commitIssueBatch(writes, []);
    return { created, updated };
  });
}
