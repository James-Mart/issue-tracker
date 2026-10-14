import { isWorkRootFinished } from "../../src/features/issues/lib/derived.js";
import type { ConversationMeta, Issue, IssuesResponse } from "../schemas.js";
import { listIndexedConversationMetas } from "./conversation-meta-index.js";
import { IssueError } from "./errors.js";
import { isImplementingWorkRootIssue } from "./implementing-launch.js";
import { projectContaining } from "./subtree.js";

export type WorkRoot = Extract<Issue, { kind: "epic" | "story" }>;

/** Epic or project-level Story work root, if `issue` is one. */
export function implementingWorkRootFromIssue(
  issue: Issue,
  byId: Map<string, Issue>,
): WorkRoot | undefined {
  const parentKind =
    issue.kind === "story" ? byId.get(issue.partOf)?.kind : undefined;
  if (!isImplementingWorkRootIssue(issue.kind, parentKind)) return undefined;
  return issue as WorkRoot;
}

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

function countsAsOpenSlot(
  root: WorkRoot,
  projectId: string,
  issues: Issue[],
  derived: SlotSnapshot["derived"],
  byId: Map<string, Issue>,
): boolean {
  if (root.archived || projectContaining(root, byId) !== projectId) return false;
  return !isWorkRootFinished(root, issues, derived);
}

/**
 * Ids of the Project's work roots holding a slot.
 * A non-archived `implementing` session on a root that is neither archived
 * nor finished holds one. So does a still-queued root with `needsAttention`:
 * a failed start stays among the active slots until that flag is cleared.
 */
export function slotHoldingRootIds(
  projectId: string,
  { issues, derived, byId }: SlotSnapshot,
): Set<string> {
  const openByRoot = new Set(openSessions(byId).map(({ root }) => root.id));
  const held = new Set<string>();
  for (const issue of issues) {
    if (issue.kind !== "epic" && issue.kind !== "story") continue;
    const queuedAttention = Boolean(issue.workQueuedAt) && issue.needsAttention;
    if (!openByRoot.has(issue.id) && !queuedAttention) continue;
    if (countsAsOpenSlot(issue, projectId, issues, derived, byId)) {
      held.add(issue.id);
    }
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
