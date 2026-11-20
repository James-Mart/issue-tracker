import type { Issue, PendingAppend } from "../schemas.js";
import { IssueError } from "./errors.js";
import { readAll, readOutlineFromIssues, serialize } from "./issues.js";
import { commitWithPlanGates } from "./plan-gates.js";
import { ancestorChain, nearestImplementingWorkRootId } from "./subtree.js";

type OutlineIssue = Extract<Issue, { kind: "outline" }>;

/** `outline` with `entry` added after any appends already pending. */
export function withPendingAppend(
  outline: OutlineIssue,
  entry: PendingAppend,
): OutlineIssue {
  return { ...outline, pendingAppends: [...(outline.pendingAppends ?? []), entry] };
}

/**
 * Apply the gates of the append `sourceIdea` concluded onto `outlineId` to its
 * target Story, and drop that entry from the outline's pending appends. With
 * code approval required, the Story drops to `manual`. When the execution gate
 * starts work, the Story's work root joins the queue unless the queue refuses
 * it, which leaves an implementing run on that root in place. Reconcile calls
 * this once that Story holds the append's Tasks.
 */
export function applyPendingAppend(
  outlineId: string,
  sourceIdea: string,
): Promise<void> {
  return serialize(() => {
    const { issues } = readAll();
    const now = new Date().toISOString();
    const { outline, entry } = withoutPendingAppend(
      readOutlineFromIssues(issues, outlineId),
      sourceIdea,
      now,
    );
    const rootId = nearestImplementingWorkRootId(
      ancestorChain(entry.targetStory, issues),
    );
    if (!rootId) {
      throw new IssueError(
        "validation",
        `pending append target "${entry.targetStory}" is not in a work root`,
      );
    }
    commitWithPlanGates(
      new Map(issues.map((issue) => [issue.id, issue])),
      [outline],
      { lowerId: entry.targetStory, rootId },
      {
        executionGate: entry.executionGate,
        codeApprovalRequired: entry.codeApprovalRequired,
      },
      now,
    );
  });
}

/** `outline` without the append `sourceIdea` concluded onto it, and that entry. */
function withoutPendingAppend(
  outline: OutlineIssue,
  sourceIdea: string,
  now: string,
): { outline: OutlineIssue; entry: PendingAppend } {
  const pending = outline.pendingAppends ?? [];
  const entry = pending.find((item) => item.sourceIdea === sourceIdea);
  if (!entry) {
    throw new IssueError(
      "validation",
      `outline "${outline.id}" has no pending append from idea "${sourceIdea}"`,
    );
  }
  const remaining = pending.filter((item) => item.sourceIdea !== sourceIdea);
  return {
    outline: {
      ...outline,
      pendingAppends: remaining.length > 0 ? remaining : undefined,
      updatedAt: now,
    },
    entry,
  };
}
