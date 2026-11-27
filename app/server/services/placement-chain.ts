import type { ConversationMessageSessions } from "./conversation-message.js";
import { readConversationMeta } from "./conversations.js";
import { IssueError } from "./errors.js";
import { checkIntegrity } from "./integrity.js";
import {
  commitIssueBatch,
  readAll,
  readOutlineOrThrow,
  serialize,
} from "./issues.js";
import { stampedBoardRoots } from "./linked-roots.js";
import { derive } from "./derive.js";
import {
  requireNoPlacement,
  startOutlinePlanningSession,
  type StartOutlinePlanningSessionInput,
} from "./outline-planning-session.js";
import { releaseWorkRoot } from "./release-work-root.js";
import type { ConversationMeta, Issue } from "../schemas.js";
import type {
  PlacementAction,
  PlacementChain,
  PlacementStep,
} from "../schemas/placement-chain.js";
import { PLACEMENT_FIRST_STEP } from "../../src/features/issues/lib/placement-actions.js";
import type { TaskingRunOutcome } from "./review-tasking.js";

type OutlineIssue = Extract<Issue, { kind: "outline" }>;

const NEXT_STEP = {
  decomposer: "reconciler",
  reconciler: "polish",
  polish: "release",
} as const satisfies Record<PlacementStep, PlacementStep | "release">;

function samePlacement(
  stored: PlacementChain | undefined,
  expected: PlacementChain,
): boolean {
  if (!stored) return false;
  return (
    stored.root === expected.root &&
    stored.action === expected.action &&
    stored.from === expected.from &&
    stored.version === expected.version
  );
}

function writeOutline(outline: OutlineIssue): void {
  const { issues } = readAll();
  const next = issues.map((issue) => (issue.id === outline.id ? outline : issue));
  const problems = checkIntegrity(next);
  if (problems.length > 0) {
    throw new IssueError(
      "validation",
      problems.map((problem) => problem.message).join("; "),
    );
  }
  commitIssueBatch([{ issue: outline }], []);
}

function withoutChain(outline: OutlineIssue): OutlineIssue {
  const { placementChain: _chain, ...rest } = outline;
  return { ...rest, updatedAt: new Date().toISOString() };
}

/** Drop `expected` when it is still the outline's chain. Caller holds `serialize()`. */
function clearMatchingChain(outlineId: string, expected: PlacementChain): void {
  const outline = readOutlineOrThrow(outlineId);
  if (!samePlacement(outline.placementChain, expected)) return;
  writeOutline(withoutChain(outline));
}

async function clearMatchingChainLater(
  outlineId: string,
  expected: PlacementChain,
): Promise<void> {
  await serialize(() => {
    clearMatchingChain(outlineId, expected);
  });
}

/**
 * The root must be an open linked root of the outline and behind its latest
 * body. `from` is that root's stamp.
 */
function requireBehindOpenRoot(outlineId: string, rootId: string): number {
  const { issues } = readAll();
  const derived = derive(issues).byId;
  const root = stampedBoardRoots(issues, derived, false).find(
    (candidate) => candidate.id === rootId && candidate.outlineId === outlineId,
  );
  if (!root || !root.open || !root.behind) {
    throw new IssueError(
      "validation",
      `root "${rootId}" is not an open behind linked root of outline "${outlineId}"`,
    );
  }
  return root.version;
}

function stepSession(
  outlineId: string,
  chain: PlacementChain,
): StartOutlinePlanningSessionInput {
  if (chain.step === "decomposer") {
    return {
      outlineId,
      role: "decomposer",
      mode: "update",
      version: chain.version,
      rootId: chain.root,
    };
  }
  if (chain.step === "reconciler") {
    return {
      outlineId,
      role: "reconciler",
      version: chain.version,
      rootId: chain.root,
    };
  }
  return {
    outlineId,
    role: "polish",
    version: chain.version,
    rootId: chain.root,
    from: chain.from,
  };
}

/**
 * Start Update or Reconcile only on one root: store the chain at the
 * action's first step, then open that session. A stored chain or a busy
 * outline channel is `409`. A root that is not an open behind linked root
 * is refused. The chain is cleared when the session does not start.
 */
export async function startRootPlacement(
  outlineId: string,
  rootId: string,
  action: PlacementAction,
  sessions: ConversationMessageSessions,
): Promise<ConversationMeta> {
  const chain = await serialize(() => {
    const outline = readOutlineOrThrow(outlineId);
    requireNoPlacement(outline);
    const from = requireBehindOpenRoot(outlineId, rootId);
    const next: PlacementChain = {
      root: rootId,
      action,
      from,
      version: outline.bodyVersion,
      step: PLACEMENT_FIRST_STEP[action],
    };
    writeOutline({
      ...outline,
      placementChain: next,
      updatedAt: new Date().toISOString(),
    });
    return next;
  });
  try {
    return await startOutlinePlanningSession(
      stepSession(outlineId, chain),
      sessions,
    );
  } catch (error) {
    await clearMatchingChainLater(outlineId, chain);
    throw error;
  }
}

/**
 * Advance the outline's placement chain when its current step's run ends.
 * `finished` starts the next session, or releases the root after polish.
 * Any other ending clears the chain and leaves the root's stamp as it is.
 * Returns false when this run is not the chain's current step.
 */
export async function classifyPlacementRun(
  conversationId: string,
  outcome: TaskingRunOutcome,
  sessions: ConversationMessageSessions,
): Promise<boolean> {
  let meta: ConversationMeta;
  try {
    meta = readConversationMeta(conversationId);
  } catch (error) {
    if (error instanceof IssueError && error.code === "not_found") return false;
    throw error;
  }
  const role = meta.outlineRole;
  if (role !== "decomposer" && role !== "reconciler" && role !== "polish") {
    return false;
  }
  if (meta.issueId === undefined) return false;
  const outline = readOutlineOrThrow(meta.issueId);
  const chain = outline.placementChain;
  if (!chain || chain.step !== role) return false;

  if (outcome.status !== "finished") {
    await clearMatchingChainLater(outline.id, chain);
    return true;
  }

  const next = NEXT_STEP[chain.step];
  if (next === "release") {
    try {
      await releaseWorkRoot(chain.root, { again: true });
    } catch (error) {
      // Placement must not stay live when release fails: the row can start
      // again, and the root's stamp is left as it is.
      console.error(
        `placement release failed for root ${chain.root} on outline ${outline.id}`,
        error,
      );
    }
    await clearMatchingChainLater(outline.id, chain);
    return true;
  }

  const advanced = await serialize(() => {
    const current = readOutlineOrThrow(outline.id);
    if (!samePlacement(current.placementChain, chain)) return false;
    writeOutline({
      ...current,
      placementChain: { ...chain, step: next },
      updatedAt: new Date().toISOString(),
    });
    return true;
  });
  if (!advanced) return true;

  try {
    await startOutlinePlanningSession(
      stepSession(outline.id, { ...chain, step: next }),
      sessions,
    );
  } catch (error) {
    // A follow-up that does not start must not leave the chain set, or the
    // row cannot be started again.
    console.error(
      `placement chain on outline ${outline.id} did not start ${next}`,
      error,
    );
    await clearMatchingChainLater(outline.id, chain);
  }
  return true;
}
