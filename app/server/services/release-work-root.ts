import { resolveExecutionGate } from "../../src/features/issues/lib/outline-planning-launch.js";
import type { Issue } from "../schemas.js";
import { planCodeGateMergePolicyLowering } from "./code-gate-merge-policy.js";
import { IssueError } from "./errors.js";
import { checkIntegrity } from "./integrity.js";
import {
  commitIssueBatch,
  ensureMigrations,
  readAll,
  readIssueOrThrow,
  serialize,
} from "./issues.js";
import { assertMergePolicyLattice } from "./merge-policy.js";
import { queueRefusal, withQueueStamp } from "./work-queue.js";
import { implementingWorkRootFromIssue, type WorkRoot } from "./work-slots.js";

type OutlineIssue = Extract<Issue, { kind: "outline" }>;

/**
 * Mark a work root's plan final from its source outline's settings: set
 * `releasedAt`, lower the root to `manual` when code approval is required,
 * and queue it when the execution gate starts it. A root its queue checks
 * refuse (blocked, already queued, holding a slot) stays unqueued. A root
 * that already carries `releasedAt` is left as it is. Resolves to the root's
 * `releasedAt`.
 */
export function releaseWorkRoot(id: string): Promise<string> {
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
    if (root.releasedAt) return root.releasedAt;

    const outline = settingsOutlineOf(root, byId);
    const now = new Date().toISOString();
    const { written, prospective } = releaseWrites(root, outline, byId, now);
    const problems = checkIntegrity(prospective);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((problem) => problem.message).join("; "),
      );
    }
    if (outline.codeApprovalRequired === true) {
      assertMergePolicyLattice(prospective);
    }
    commitIssueBatch(
      written.map((issue) => ({ issue })),
      [],
    );
    return now;
  });
}

function settingsOutlineOf(
  root: WorkRoot,
  byId: Map<string, Issue>,
): OutlineIssue {
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
  return outline;
}

function releaseWrites(
  root: WorkRoot,
  outline: OutlineIssue,
  byId: Map<string, Issue>,
  now: string,
): { written: Issue[]; prospective: Issue[] } {
  const next = new Map(byId);
  const writtenIds = new Set<string>();
  const write = (issue: Issue) => {
    next.set(issue.id, issue);
    writtenIds.add(issue.id);
  };

  write({ ...root, releasedAt: now, updatedAt: now });
  if (outline.codeApprovalRequired === true) {
    for (const lowered of planCodeGateMergePolicyLowering(root.id, [
      ...next.values(),
    ])) {
      write({ ...lowered, updatedAt: now });
    }
  }

  const gate = resolveExecutionGate(
    outline.executionGate,
    outline.codeApprovalRequired,
  );
  if (gate === "off") {
    const issues = [...next.values()];
    const released = implementingWorkRootFromIssue(next.get(root.id)!, next)!;
    if (!queueRefusal(released, issues, next)) {
      write(withQueueStamp(released, issues, next, now));
    }
  }

  const prospective = [...next.values()];
  return {
    written: prospective.filter((issue) => writtenIds.has(issue.id)),
    prospective,
  };
}
