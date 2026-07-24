import {
  buildProjectBoardOf,
  isProjectBoardChild,
} from "../order.js";
import { IssueError } from "./errors.js";
import {
  commitIssueBatch,
  readAll,
  serialize,
  type IssueWrite,
} from "./issues.js";
import { checkIntegrity } from "./integrity.js";

export interface ReorderBoardResult {
  /** Board-root ids in the project after reorder, by new `order`. */
  order: string[];
}

/**
 * Insert a Project board root (`id`) immediately before `beforeId` in the
 * shared Epic / Idea / root project-level Story `order` group. Renumbers the
 * whole group contiguously.
 */
export function reorderBoardChild(
  id: string,
  beforeId: string,
): Promise<ReorderBoardResult> {
  return serialize(() => {
    if (id === beforeId) {
      throw new IssueError(
        "validation",
        "reorder before target must differ from the moved issue",
      );
    }

    const { issues } = readAll();
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const source = byId.get(id);
    const before = byId.get(beforeId);
    if (!source) {
      throw new IssueError("not_found", `unknown issue "${id}"`);
    }
    if (!before) {
      throw new IssueError("not_found", `unknown issue "${beforeId}"`);
    }
    if (!isProjectBoardChild(source, byId)) {
      throw new IssueError(
        "validation",
        `reorder source must be a project board root, not "${source.kind}" "${id}"`,
      );
    }
    if (!isProjectBoardChild(before, byId)) {
      throw new IssueError(
        "validation",
        `reorder target must be a project board root, not "${before.kind}" "${beforeId}"`,
      );
    }
    if (source.partOf !== before.partOf) {
      throw new IssueError(
        "validation",
        "reorder source and target must share the same project",
      );
    }
    // Story→story is restack (move-story), not board reorder — match UI guard.
    if (source.kind === "story" && before.kind === "story") {
      throw new IssueError(
        "validation",
        "reorder cannot move a story before another story; use move-story to restack",
      );
    }

    const board = buildProjectBoardOf(issues).get(source.partOf) ?? [];
    const without = board.filter((issue) => issue.id !== id);
    const insertAt = without.findIndex((issue) => issue.id === beforeId);
    if (insertAt < 0) {
      throw new IssueError(
        "validation",
        `reorder target "${beforeId}" is not in the project board`,
      );
    }
    const nextOrder = [
      ...without.slice(0, insertAt),
      source,
      ...without.slice(insertAt),
    ];

    const now = new Date().toISOString();
    const writes: IssueWrite[] = [];
    const prospective = new Map(byId);
    for (let order = 0; order < nextOrder.length; order++) {
      const existing = nextOrder[order]!;
      if (existing.order === order) continue;
      const updated = { ...existing, order, updatedAt: now };
      prospective.set(updated.id, updated);
      writes.push({ issue: updated });
    }

    const ids = nextOrder.map((issue) => issue.id);
    if (writes.length === 0) {
      return { order: ids };
    }

    const problems = checkIntegrity([...prospective.values()]);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((p) => p.message).join("; "),
      );
    }

    commitIssueBatch(writes, []);
    return { order: ids };
  });
}
