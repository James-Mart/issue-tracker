import type { Issue } from "../schemas.js";
import { IssueError } from "./errors.js";
import {
  ensureMigrations,
  readAll,
  readIssueOrThrow,
  serialize,
} from "./issues.js";
import { commitWithPlanGates, type PlanGates } from "./plan-gates.js";
import { implementingWorkRootFromIssue, type WorkRoot } from "./work-slots.js";

/**
 * Mark a work root's plan final from its source outline's settings: set
 * `releasedAt`, lower the root to `manual` when code approval is required,
 * and queue it when the execution gate starts it. A root its queue checks
 * refuse (blocked, already queued, holding a slot) stays unqueued. A root
 * that already carries `releasedAt` is left as it is unless `again` is set,
 * which reapplies the outline's current gates and keeps the stored timestamp.
 * Resolves to the root's `releasedAt`.
 */
export function releaseWorkRoot(
  id: string,
  options?: { again?: boolean },
): Promise<string> {
  return serialize(() => {
    ensureMigrations();
    const current = readIssueOrThrow(id);
    const { issues } = readAll();
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const root = implementingWorkRootFromIssue(current, byId);
    if (!root) {
      throw new IssueError(
        "validation",
        `issue "${id}" is not an Epic or project-level Story`,
      );
    }
    if (root.releasedAt && options?.again !== true) return root.releasedAt;

    const now = new Date().toISOString();
    const releasedAt = root.releasedAt ?? now;
    commitWithPlanGates(
      byId,
      [{ ...root, releasedAt, updatedAt: now }],
      { lowerId: root.id, rootId: root.id },
      outlineGatesOf(root, byId),
      now,
    );
    return releasedAt;
  });
}

function outlineGatesOf(root: WorkRoot, byId: Map<string, Issue>): PlanGates {
  if (!root.sourceOutline) {
    throw new IssueError(
      "validation",
      `work root "${root.id}" has no sourceOutline; release reads its outline's plan settings`,
    );
  }
  const outline = byId.get(root.sourceOutline.outline);
  if (outline?.kind !== "outline") {
    throw new IssueError(
      "validation",
      `sourceOutline "${root.sourceOutline.outline}" of work root "${root.id}" is not an outline`,
    );
  }
  if (outline.executionGate === undefined) {
    throw new IssueError(
      "validation",
      `outline "${outline.id}" carries no plan settings; conclude its Idea first`,
    );
  }
  return {
    executionGate: outline.executionGate,
    codeApprovalRequired: outline.codeApprovalRequired,
  };
}
