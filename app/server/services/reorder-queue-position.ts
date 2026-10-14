import { nextWaitingOrder } from "../../src/features/issues/lib/queue-reorder.js";
import { queueStage } from "../../src/features/issues/lib/queue-view.js";
import type { Issue } from "../schemas.js";
import { derive } from "./derive.js";
import { IssueError } from "./errors.js";
import { checkIntegrity } from "./integrity.js";
import {
  commitIssueBatch,
  ensureMigrations,
  readAll,
  readIssueOrThrow,
  serialize,
  type IssueWrite,
} from "./issues.js";
import { projectContaining } from "./subtree.js";
import { refuseWorkQueueConflict } from "./work-queue.js";
import {
  implementingWorkRootFromIssue,
  slotHoldingRootIds,
  type WorkRoot,
} from "./work-slots.js";

export interface QueuePositionResult {
  /** Waiting root ids in this Project, in `workQueuePosition` order. */
  order: string[];
}

/**
 * Move a waiting work root to `index` (zero-based) among its Project's
 * waiting roots. An order that would put a waiting root ahead of one it is
 * `blockedBy` is refused.
 */
export async function reorderQueuePosition(
  id: string,
  index: number,
): Promise<QueuePositionResult> {
  if (!Number.isInteger(index)) {
    throw new IssueError("validation", "index must be an integer");
  }
  return serialize(() => {
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
    const projectId = projectContaining(root, byId);
    if (!projectId) {
      throw new IssueError("validation", `work root "${root.id}" has no project`);
    }
    if (!root.workQueuedAt) {
      refuseWorkQueueConflict(
        "not-queued",
        `work root "${root.title}" is not queued`,
      );
    }
    const derived = derive(issues);
    const slots = slotHoldingRootIds(projectId, {
      issues,
      derived: derived.byId,
      byId,
    });
    if (slots.has(root.id)) {
      refuseWorkQueueConflict(
        "holds-slot",
        `work root "${root.title}" holds an implementing slot`,
      );
    }
    const waiting = waitingRoots(projectId, issues, derived.byId, byId, slots);
    const currentIndex = waiting.findIndex((item) => item.id === root.id);
    if (currentIndex < 0) {
      refuseWorkQueueConflict(
        "not-waiting",
        `work root "${root.title}" is not waiting`,
      );
    }
    if (index < 0 || index >= waiting.length) {
      throw new IssueError(
        "validation",
        `index must be from 0 to ${waiting.length - 1} among waiting roots`,
      );
    }
    if (index === currentIndex) {
      return { order: waiting.map((item) => item.id) };
    }
    const orderIds = nextWaitingOrder(
      waiting.map((item) => item.id),
      root.id,
      index,
    );
    if (!orderIds) {
      throw new Error(`waiting order for "${root.id}" could not be built`);
    }
    const waitingById = new Map(waiting.map((item) => [item.id, item]));
    const next = orderIds.map((waitingId) => {
      const item = waitingById.get(waitingId);
      if (!item) {
        throw new Error(`waiting root "${waitingId}" disappeared before reorder`);
      }
      return item;
    });
    const blocker = firstWaitingOrderBlocker(next);
    if (blocker) {
      refuseWorkQueueConflict(
        "blocked",
        `Blocked by ${blocker.title}, so it must be queued after it`,
      );
    }
    const positions = waitingPositions(waiting);
    const now = new Date().toISOString();
    const writes: IssueWrite[] = [];
    const prospective = new Map(byId);
    for (let place = 0; place < next.length; place++) {
      const existing = next[place]!;
      const position = positions[place]!;
      if (existing.workQueuePosition === position) continue;
      const updated = { ...existing, workQueuePosition: position, updatedAt: now };
      prospective.set(updated.id, updated);
      writes.push({ issue: updated });
    }
    const order = next.map((item) => item.id);
    if (writes.length === 0) return { order };
    const problems = checkIntegrity([...prospective.values()]);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((problem) => problem.message).join("; "),
      );
    }
    commitIssueBatch(writes, []);
    return { order };
  });
}

export function waitingRoots(
  projectId: string,
  issues: Issue[],
  derived: ReturnType<typeof derive>["byId"],
  byId: Map<string, Issue>,
  slots: Set<string>,
): WorkRoot[] {
  const waiting: WorkRoot[] = [];
  for (const issue of issues) {
    if (issue.kind !== "epic" && issue.kind !== "story") continue;
    if (projectContaining(issue, byId) !== projectId) continue;
    if (slots.has(issue.id)) continue;
    if (queueStage(issue, derived[issue.id], issues, derived, byId) !== "waiting") {
      continue;
    }
    waiting.push(issue);
  }
  waiting.sort(compareWaiting);
  return waiting;
}

function compareWaiting(a: WorkRoot, b: WorkRoot): number {
  const position =
    (a.workQueuePosition ?? Number.MAX_SAFE_INTEGER) -
    (b.workQueuePosition ?? Number.MAX_SAFE_INTEGER);
  if (position !== 0) return position;
  return a.id.localeCompare(b.id);
}

/** Positions already held by these waiting roots, low to high, each used once. */
function waitingPositions(waiting: WorkRoot[]): number[] {
  const positions: number[] = [];
  const seen = new Set<number>();
  for (const root of waiting) {
    if (root.workQueuePosition === undefined) {
      throw new Error(`queued work root "${root.id}" has no workQueuePosition`);
    }
    if (seen.has(root.workQueuePosition)) {
      throw new Error(
        `work root "${root.id}" shares workQueuePosition ${root.workQueuePosition}`,
      );
    }
    seen.add(root.workQueuePosition);
    positions.push(root.workQueuePosition);
  }
  return positions;
}

/**
 * First waiting root that would sit ahead of a root it is `blockedBy`.
 * Blockers that are not themselves waiting are already ahead of this band.
 */
export function firstWaitingOrderBlocker(
  ordered: WorkRoot[],
): { title: string } | undefined {
  const indexOf = new Map(ordered.map((root, place) => [root.id, place]));
  for (const root of ordered) {
    if (root.kind !== "epic") continue;
    for (const blockerId of root.blockedBy) {
      const blockerAt = indexOf.get(blockerId);
      const rootAt = indexOf.get(root.id);
      if (blockerAt === undefined || rootAt === undefined || rootAt >= blockerAt) {
        continue;
      }
      const blocker = ordered[blockerAt];
      if (!blocker) {
        throw new Error(`blocker "${blockerId}" is missing from the waiting order`);
      }
      return { title: blocker.title };
    }
  }
  return undefined;
}
