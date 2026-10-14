import type { IssueDetail } from "../schemas.js";
import { isWorkRootFinished } from "../../src/features/issues/lib/derived.js";
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
import { projectContaining } from "./subtree.js";
import { refuseWorkQueueConflict } from "./work-queue.js";
import {
  implementingTurnIsLive,
  implementingWorkRootFromIssue,
  slotHoldingRootIds,
} from "./work-slots.js";

export const PARK_ALREADY_PARKED = "already-parked";
export const PARK_NOT_PAUSED = "not-paused";
export const PARK_RUNNING = "running";

/**
 * Park a paused work root. Sets `workParkedAt` so the root leaves the slot
 * count while its implementing session stays open.
 */
export async function parkWorkRoot(
  id: string,
  sessions: { getActiveRun(conversationId: string): unknown },
): Promise<IssueDetail> {
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
    if (root.workParkedAt) {
      refuseWorkQueueConflict(
        PARK_ALREADY_PARKED,
        `work root "${root.title}" is already parked`,
      );
    }
    if (root.archived) {
      refuseWorkQueueConflict("archived", `work root "${root.title}" is archived`);
    }
    const derived = derive(issues);
    if (isWorkRootFinished(root, issues, derived.byId)) {
      refuseWorkQueueConflict("finished", `work root "${root.title}" is finished`);
    }
    const projectId = projectContaining(root, byId);
    if (!projectId) {
      throw new IssueError("validation", `work root "${root.id}" has no project`);
    }
    if (implementingTurnIsLive(root.id, sessions)) {
      refuseWorkQueueConflict(
        PARK_RUNNING,
        `work root "${root.title}" is running`,
      );
    }
    const slotHolders = slotHoldingRootIds(projectId, {
      issues,
      derived: derived.byId,
      byId,
    });
    if (!slotHolders.has(root.id)) {
      refuseWorkQueueConflict(
        PARK_NOT_PAUSED,
        `work root "${root.title}" is not paused`,
      );
    }
    const now = new Date().toISOString();
    const parked = { ...root, workParkedAt: now, updatedAt: now };
    const prospective = issues.map((issue) =>
      issue.id === parked.id ? parked : issue,
    );
    const problems = problemsFor(parked.id, prospective);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((problem) => problem.message).join("; "),
      );
    }
    commitIssueBatch([{ issue: parked }], []);
  });
  return read(id);
}
