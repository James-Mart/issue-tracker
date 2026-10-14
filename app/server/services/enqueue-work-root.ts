import type { Issue, IssueDetail } from "../schemas.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import { derive } from "./derive.js";
import { IssueError } from "./errors.js";
import { isImplementingWorkRootIssue } from "./implementing-launch.js";
import { problemsFor } from "./integrity.js";
import { isWorkRootFinished } from "../../src/features/issues/lib/derived.js";
import {
  commitIssueBatch,
  ensureMigrations,
  read,
  readAll,
  readIssueOrThrow,
  serialize,
} from "./issues.js";
import { projectContaining } from "./subtree.js";
import { firstBlockingEnqueueBlocker, withQueueStamp } from "./work-queue.js";
import { runLauncherPass } from "./work-queue-launcher.js";
import { slotHoldingRootIds, type WorkRoot } from "./work-slots.js";

export const ENQUEUE_ALREADY_QUEUED = "already-queued";
export const ENQUEUE_HOLDS_SLOT = "holds-slot";

function implementingWorkRoot(
  issue: Issue,
  byId: Map<string, Issue>,
): WorkRoot | undefined {
  const parentKind =
    issue.kind === "story" ? byId.get(issue.partOf)?.kind : undefined;
  if (!isImplementingWorkRootIssue(issue.kind, parentKind)) return undefined;
  if (issue.kind !== "epic" && issue.kind !== "story") return undefined;
  return issue;
}

function refuseEnqueue(reason: string, message: string): never {
  throw new IssueError("conflict", message, { reason });
}

/**
 * Queue an unarchived, unfinished work root that is not already in the queue.
 * When it is eligible to start and a slot is free, the launcher starts it
 * before this returns. The response is the root after that pass.
 */
export async function enqueueWorkRoot(
  id: string,
  sessions: ConversationMessageSessions,
): Promise<IssueDetail> {
  await serialize(() => {
    ensureMigrations();
    readIssueOrThrow(id);
    const { issues } = readAll();
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const current = byId.get(id);
    const root = current ? implementingWorkRoot(current, byId) : undefined;
    if (!root) {
      throw new IssueError(
        "validation",
        `issue "${id}" is not an implementing work root`,
      );
    }
    if (root.archived) {
      refuseEnqueue("archived", `work root "${root.title}" is archived`);
    }
    const derived = derive(issues);
    if (isWorkRootFinished(root, issues, derived.byId)) {
      refuseEnqueue("finished", `work root "${root.title}" is finished`);
    }
    if (root.workQueuedAt) {
      refuseEnqueue(
        ENQUEUE_ALREADY_QUEUED,
        `work root "${root.title}" is already queued`,
      );
    }
    const projectId = projectContaining(root, byId);
    if (!projectId) {
      throw new IssueError("validation", `work root "${root.id}" has no project`);
    }
    const slotHolders = slotHoldingRootIds(projectId, {
      issues,
      derived: derived.byId,
      byId,
    });
    if (slotHolders.has(root.id)) {
      refuseEnqueue(
        ENQUEUE_HOLDS_SLOT,
        `work root "${root.title}" already holds an implementing slot`,
      );
    }
    const blocker = firstBlockingEnqueueBlocker(
      root,
      issues,
      derived,
      byId,
      slotHolders,
    );
    if (blocker) {
      refuseEnqueue(
        "blocked",
        `Blocked by ${blocker.title}, so it must be queued after it`,
      );
    }
    const stamped = withQueueStamp(root, issues, byId, new Date().toISOString());
    const prospective = issues.map((issue) =>
      issue.id === stamped.id ? stamped : issue,
    );
    const problems = problemsFor(stamped.id, prospective);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((problem) => problem.message).join("; "),
      );
    }
    commitIssueBatch([{ issue: stamped }], []);
  });
  await runLauncherPass(sessions);
  return read(id);
}
