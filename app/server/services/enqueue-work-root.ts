import type { IssueDetail } from "../schemas.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
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
import {
  queueRefusal,
  refuseWorkQueueConflict,
  withQueueStamp,
} from "./work-queue.js";
import { drainWorkQueue } from "./work-queue-launcher.js";
import { implementingWorkRootFromIssue } from "./work-slots.js";

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
    const root = current
      ? implementingWorkRootFromIssue(current, byId)
      : undefined;
    if (!root) {
      throw new IssueError(
        "validation",
        `issue "${id}" is not an implementing work root`,
      );
    }
    const refusal = queueRefusal(root, issues, byId);
    if (refusal) refuseWorkQueueConflict(refusal.reason, refusal.message);
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
  await drainWorkQueue(sessions);
  return read(id);
}
