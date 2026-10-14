import type { IssueDetail } from "../schemas.js";
import { derive } from "./derive.js";
import { IssueError } from "./errors.js";
import { problemsFor } from "./integrity.js";
import {
  commitIssueBatch,
  ensureMigrations,
  read,
  readAll,
  readIssueOrThrow,
  serialize,
} from "./issues.js";
import { mergeIssue } from "./merge.js";
import { projectContaining } from "./subtree.js";
import { queueDeparturePatch, refuseWorkQueueConflict } from "./work-queue.js";
import {
  implementingWorkRootFromIssue,
  slotHoldingRootIds,
} from "./work-slots.js";

export const DEQUEUE_NOT_QUEUED = "not-queued";
export const DEQUEUE_HOLDS_SLOT = "holds-slot";

/**
 * Remove a waiting or parked work root from its Project queue. Running and
 * paused roots (slot holders) are refused.
 */
export async function dequeueWorkRoot(id: string): Promise<IssueDetail> {
  await serialize(() => {
    ensureMigrations();
    readIssueOrThrow(id);
    const { issues } = readAll();
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const current = byId.get(id);
    const root = current
      ? implementingWorkRootFromIssue(current, byId)
      : undefined;
    if (!root) {
      throw new IssueError(
        "validation",
        `issue "${id}" is not an implementing work root`,
      );
    }
    if (!root.workQueuedAt && !root.workParkedAt) {
      refuseWorkQueueConflict(
        DEQUEUE_NOT_QUEUED,
        `work root "${root.title}" is not queued`,
      );
    }
    const projectId = projectContaining(root, byId);
    if (!projectId) {
      throw new IssueError("validation", `work root "${root.id}" has no project`);
    }
    const derived = derive(issues);
    const slotHolders = slotHoldingRootIds(projectId, {
      issues,
      derived: derived.byId,
      byId,
    });
    if (slotHolders.has(root.id)) {
      refuseWorkQueueConflict(
        DEQUEUE_HOLDS_SLOT,
        `work root "${root.title}" holds an implementing slot`,
      );
    }
    const cleared = mergeIssue(root, queueDeparturePatch());
    const prospective = issues.map((issue) =>
      issue.id === cleared.id ? cleared : issue,
    );
    const problems = problemsFor(cleared.id, prospective);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((problem) => problem.message).join("; "),
      );
    }
    commitIssueBatch([{ issue: cleared }], []);
  });
  return read(id);
}
