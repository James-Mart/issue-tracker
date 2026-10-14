import { isWorkRootFinished } from "../../src/features/issues/lib/derived.js";
import type { ConversationMeta, Issue, IssuesResponse } from "../schemas.js";
import { listIndexedConversationMetas } from "./conversation-meta-index.js";
import { IssueError } from "./errors.js";
import { projectContaining } from "./subtree.js";

export type WorkRoot = Extract<Issue, { kind: "epic" | "story" }>;

export type SlotSnapshot = Pick<IssuesResponse, "issues" | "derived"> & {
  byId: Map<string, Issue>;
};

type OpenSession = { conversationId: string; root: WorkRoot };

function isOpenImplementingMeta(meta: ConversationMeta): boolean {
  return !meta.archived && meta.channel === "implementing";
}

export function hasOpenImplementingSession(): boolean {
  return listIndexedConversationMetas().some(isOpenImplementingMeta);
}

/** Non-archived `implementing` sessions, each with the work root it anchors on. */
function openSessions(byId: Map<string, Issue>): OpenSession[] {
  const open: OpenSession[] = [];
  for (const meta of listIndexedConversationMetas()) {
    if (!isOpenImplementingMeta(meta) || !meta.issueId) continue;
    const root = byId.get(meta.issueId);
    if (root?.kind !== "epic" && root?.kind !== "story") continue;
    open.push({ conversationId: meta.id, root });
  }
  return open;
}

/**
 * Ids of the Project's work roots holding a slot: a non-archived
 * `implementing` session on a root that is neither archived nor finished.
 */
export function slotHoldingRootIds(
  projectId: string,
  { issues, derived, byId }: SlotSnapshot,
): Set<string> {
  const held = new Set<string>();
  for (const { root } of openSessions(byId)) {
    if (held.has(root.id) || root.archived) continue;
    if (projectContaining(root, byId) !== projectId) continue;
    if (isWorkRootFinished(root, issues, derived)) continue;
    held.add(root.id);
  }
  return held;
}

/** Ids of non-archived `implementing` sessions on finished work roots. */
export function finishedRootSessionIds({
  issues,
  derived,
  byId,
}: SlotSnapshot): string[] {
  return openSessions(byId)
    .filter(({ root }) => isWorkRootFinished(root, issues, derived))
    .map(({ conversationId }) => conversationId);
}

/**
 * Refuse a new `implementing` session on `rootId` when the Project's held
 * slots already reach `maxImplementingRuns`. A root that holds a slot may
 * replace its own session.
 */
export function refuseIfNoFreeSlot(
  projectId: string,
  rootId: string,
  { issues, derived }: Pick<IssuesResponse, "issues" | "derived">,
): void {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const project = byId.get(projectId);
  if (project?.kind !== "project") {
    throw new IssueError("not_found", `unknown project "${projectId}"`);
  }
  const held = slotHoldingRootIds(projectId, { issues, derived, byId });
  if (held.has(rootId) || held.size < project.maxImplementingRuns) return;
  throw new IssueError(
    "no-free-slot",
    `${project.title} has no free implementing slot (maxImplementingRuns ${project.maxImplementingRuns})`,
  );
}
