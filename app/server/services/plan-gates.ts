import { resolveExecutionGate } from "../../src/features/issues/lib/outline-planning-launch.js";
import type { ExecutionGate, Issue } from "../schemas.js";
import { planCodeGateMergePolicyLowering } from "./code-gate-merge-policy.js";
import { IssueError } from "./errors.js";
import { checkIntegrity } from "./integrity.js";
import { commitIssueBatch } from "./issues.js";
import { assertMergePolicyLattice } from "./merge-policy.js";
import { queueRefusal, withQueueStamp } from "./work-queue.js";
import { implementingWorkRootFromIssue } from "./work-slots.js";

export type PlanGates = {
  executionGate: ExecutionGate;
  codeApprovalRequired: boolean | undefined;
};

/**
 * Commit `writes` together with a plan's gates as one batch. With code
 * approval required, `lowerId` and any descendant above `manual` drop to
 * `manual`. When the execution gate starts work, the work root `rootId` joins
 * the back of its Project's queue unless the queue refuses it (archived,
 * finished, already queued or parked, holding a slot, or blocked). The
 * resulting store is checked before anything is written. Caller holds issues
 * `serialize()`.
 */
export function commitWithPlanGates(
  current: ReadonlyMap<string, Issue>,
  writes: readonly Issue[],
  target: { lowerId: string; rootId: string },
  gates: PlanGates,
  now: string,
): void {
  const next = new Map(current);
  const written = new Map<string, Issue>();
  const write = (issue: Issue) => {
    next.set(issue.id, issue);
    written.set(issue.id, issue);
  };
  for (const issue of writes) write(issue);

  if (gates.codeApprovalRequired === true) {
    for (const lowered of planCodeGateMergePolicyLowering(target.lowerId, [
      ...next.values(),
    ])) {
      write({ ...lowered, updatedAt: now });
    }
  }

  if (resolveExecutionGate(gates.executionGate, gates.codeApprovalRequired) === "off") {
    const issues = [...next.values()];
    const root = implementingWorkRootFromIssue(next.get(target.rootId)!, next)!;
    if (!queueRefusal(root, issues, next)) {
      write(withQueueStamp(root, issues, next, now));
    }
  }

  const prospective = [...next.values()];
  const problems = checkIntegrity(prospective);
  if (problems.length > 0) {
    throw new IssueError(
      "validation",
      problems.map((problem) => problem.message).join("; "),
    );
  }
  if (gates.codeApprovalRequired === true) {
    assertMergePolicyLattice(prospective);
  }
  commitIssueBatch(
    [...written.values()].map((issue) => ({ issue })),
    [],
  );
}
