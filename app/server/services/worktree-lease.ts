import { worktreePathFor } from "../worktree-constants.js";
import { readAll } from "./issues.js";
import { loadRoleWorktreeExclusive } from "./role-bodies.js";
import { ancestorChain, owningStory } from "./subtree.js";

type Lease = {
  delegationId: string;
  role: string;
  issueId: string;
};

/**
 * Process-wide: two coordinators in different conversations can still target
 * the same Story worktree, so leases are not scoped per conversation.
 */
const leases = new Map<string, Lease>();

/** Test helper: drop every held lease. */
export function resetWorktreeLeasesForTests(): void {
  leases.clear();
}

/**
 * The checkout an exclusive role writes into for `issueId`: the owning Story's
 * recorded `worktreePath`, or the path the git role will create for it.
 */
function worktreeKeyForIssue(role: string, issueId: string): string {
  const chain = ancestorChain(issueId, readAll().issues);
  const story = owningStory(chain);
  if (!story) {
    throw new Error(
      `delegate: role "${role}" writes a Story worktree; issueId must be a Task or Story (got "${issueId}")`,
    );
  }
  return story.worktreePath ?? worktreePathFor(chain[0]!.id, story.id);
}

/**
 * Take the worktree for a delegation, or join it when an ancestor already holds
 * it (an implementor's own git agent). Refuses when an unrelated delegation
 * holds it. The returned release is a no-op for a joined lease.
 */
function acquireWorktreeLease(
  worktree: string,
  claimant: Lease,
  ancestorDelegationIds: readonly string[],
): () => void {
  const held = leases.get(worktree);
  if (held) {
    if (ancestorDelegationIds.includes(held.delegationId)) return () => {};
    throw new Error(
      `delegate: worktree ${worktree} is in use by ${held.role} for "${held.issueId}"; ` +
        `wait for that delegation to finish before delegating ${claimant.role} for "${claimant.issueId}"`,
    );
  }
  leases.set(worktree, claimant);
  return () => {
    if (leases.get(worktree)?.delegationId === claimant.delegationId) {
      leases.delete(worktree);
    }
  };
}

/**
 * Claim the Story worktree for a delegation whose role is `worktree:
 * exclusive`; other roles (reviewers, discriminators) pass through untouched.
 */
export function claimDelegationWorktree(params: {
  role: string;
  issueId: string | undefined;
  delegationId: string;
  ancestorDelegationIds: readonly string[];
  agentsDir: string | undefined;
}): () => void {
  const { role, issueId, delegationId, ancestorDelegationIds, agentsDir } = params;
  if (!loadRoleWorktreeExclusive(role, agentsDir)) return () => {};
  if (issueId === undefined) {
    throw new Error(
      `delegate: role "${role}" writes a Story worktree; pass the Task or Story issueId`,
    );
  }
  return acquireWorktreeLease(
    worktreeKeyForIssue(role, issueId),
    { delegationId, role, issueId },
    ancestorDelegationIds,
  );
}
