import type { Issue, IssueDetail } from "../schemas.js";
import {
  listIndexedConversationMetas,
  persistConversationMeta,
} from "./conversation-meta-index.js";
import { isWorkRootFinished } from "../../src/features/issues/lib/derived.js";
import { derive } from "./derive.js";
import { IssueError } from "./errors.js";
import { checkIntegrity } from "./integrity.js";
import {
  commitIssueBatch,
  ensureMigrations,
  read,
  readAll,
  readIssueOrThrow,
  serialize,
  type IssueWrite,
} from "./issues.js";
import {
  firstWaitingOrderBlocker,
  waitingRoots,
} from "./reorder-queue-position.js";
import { projectContaining } from "./subtree.js";
import { nextQueuePosition, refuseWorkQueueConflict } from "./work-queue.js";
import {
  implementingTurnIsLive,
  implementingWorkRootFromIssue,
  slotHoldingRootIds,
  type WorkRoot,
} from "./work-slots.js";

export const RESUME_NOT_PARKED = "not-parked";
export const RESUME_RUNNING = "running";

/**
 * Return a parked root to the front of its Project's waiting roots.
 * Open implementing sessions are archived, and a failed-start
 * `needsAttention` is cleared, so the root waits in line instead of
 * reclaiming a slot. A `note` rides with the root and reaches the next
 * coordinator in its first prompt.
 */
export async function resumeParkedWorkRoot(
  id: string,
  sessions: { getActiveRun(conversationId: string): unknown },
  note?: string,
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
    if (!root.workParkedAt) {
      refuseWorkQueueConflict(
        RESUME_NOT_PARKED,
        `work root "${root.title}" is not parked`,
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
        RESUME_RUNNING,
        `work root "${root.title}" is running`,
      );
    }
    const slots = slotHoldingRootIds(projectId, {
      issues,
      derived: derived.byId,
      byId,
    });
    const waiting = waitingRoots(projectId, issues, derived.byId, byId, slots);
    const ordered = [root, ...waiting];
    const blocker = firstWaitingOrderBlocker(ordered);
    if (blocker) {
      refuseWorkQueueConflict(
        "blocked",
        `Blocked by ${blocker.title}, so it must be queued after it`,
      );
    }
    const now = new Date().toISOString();
    const positions = waitingPositions(waiting, projectId, issues, byId);
    const writes: IssueWrite[] = [];
    const prospective = new Map(byId);
    for (let place = 0; place < ordered.length; place++) {
      const existing = ordered[place]!;
      const position = positions[place]!;
      const updated: WorkRoot =
        existing.id === root.id
          ? unparkedRoot(root, position, now, note)
          : existing.workQueuePosition === position
            ? existing
            : { ...existing, workQueuePosition: position, updatedAt: now };
      if (updated === existing) continue;
      prospective.set(updated.id, updated);
      writes.push({ issue: updated });
    }
    const problems = checkIntegrity([...prospective.values()]);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((problem) => problem.message).join("; "),
      );
    }
    archiveOpenImplementingSessions(root.id, now);
    commitIssueBatch(writes, []);
  });
  return read(id);
}

function unparkedRoot(
  root: WorkRoot,
  position: number,
  now: string,
  note: string | undefined,
): WorkRoot {
  const { workParkedAt: _parked, workResumeNote: _note, ...rest } = root;
  return {
    ...rest,
    needsAttention: false,
    attentionReason: null,
    workQueuedAt: root.workQueuedAt ?? now,
    workQueuePosition: position,
    ...(note ? { workResumeNote: note } : {}),
    updatedAt: now,
  };
}

/**
 * Waiting positions in `waitingRoots` order, plus one new position at the back.
 * `waitingRoots` already sorts by `workQueuePosition`.
 */
function waitingPositions(
  waiting: WorkRoot[],
  projectId: string,
  issues: Issue[],
  byId: Map<string, Issue>,
): number[] {
  const positions = waiting.map((root) => {
    if (root.workQueuePosition === undefined) {
      throw new Error(`queued work root "${root.id}" has no workQueuePosition`);
    }
    return root.workQueuePosition;
  });
  positions.push(nextQueuePosition(projectId, issues, byId));
  return positions;
}

function archiveOpenImplementingSessions(rootId: string, now: string): void {
  for (const meta of listIndexedConversationMetas()) {
    if (
      meta.archived ||
      meta.channel !== "implementing" ||
      meta.issueId !== rootId
    ) {
      continue;
    }
    persistConversationMeta({ ...meta, archived: true, updatedAt: now });
  }
}
