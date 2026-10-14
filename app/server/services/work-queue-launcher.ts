import type { Issue } from "../schemas.js";
import type { AgentSessions } from "./agent-sessions.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import { derive } from "./derive.js";
import {
  subscribeFrames,
  type ConversationFrame,
} from "./conversation-stream.js";
import { updateMeta } from "./conversations.js";
import { IssueError } from "./errors.js";
import { guestRefusesAgentLaunch } from "./guest-agent-launch.js";
import {
  implementingSessionMessage,
  implementingSessionTitle,
} from "./implementing-launch.js";
import { startImplementingChannelSession } from "./implementing-session.js";
import { ISSUES_TOPIC, startIssueEventsWatcher } from "./issue-events.js";
import { list, readAll, update } from "./issues.js";
import { drainPlanQueue } from "./plan-queue-launcher.js";
import { projectContaining } from "./subtree.js";
import {
  compareWorkQueuedAtThenId,
  queueDeparturePatch,
} from "./work-queue.js";
import {
  finishedRootSessionIds,
  hasOpenImplementingSession,
  slotHoldingRootIds,
  type SlotSnapshot,
  type WorkRoot,
} from "./work-slots.js";

type LauncherSnapshot = SlotSnapshot & {
  attempted: Set<string>;
};

function hasQueuedWork(issues: Issue[]): boolean {
  return issues.some(
    (issue) =>
      (issue.kind === "idea" &&
        Boolean(issue.planQueuedAt) &&
        Boolean(issue.stakeholder)) ||
      ((issue.kind === "epic" || issue.kind === "story") &&
        Boolean(issue.workQueuedAt)),
  );
}

async function releaseFinishedSlots(snapshot: SlotSnapshot): Promise<void> {
  for (const conversationId of finishedRootSessionIds(snapshot)) {
    await updateMeta(conversationId, { archived: true });
  }
}

function queuePosition(root: WorkRoot): number {
  if (root.workQueuePosition === undefined) {
    throw new Error(`queued work root "${root.id}" has no workQueuePosition`);
  }
  return root.workQueuePosition;
}

function canStart(root: WorkRoot, snapshot: LauncherSnapshot): boolean {
  if (!root.workQueuedAt || snapshot.attempted.has(root.id) || root.needsAttention) {
    return false;
  }
  const state = snapshot.derived[root.id];
  return state !== undefined && !state.blocked && !state.planNotFinal;
}

function startableQueuedRoots(
  projectId: string,
  snapshot: LauncherSnapshot,
): WorkRoot[] {
  const eligible: WorkRoot[] = [];
  for (const issue of snapshot.issues) {
    if (issue.kind !== "epic" && issue.kind !== "story") continue;
    if (projectContaining(issue, snapshot.byId) !== projectId) continue;
    if (!canStart(issue, snapshot)) continue;
    eligible.push(issue);
  }
  eligible.sort(
    (a, b) =>
      queuePosition(a) - queuePosition(b) || compareWorkQueuedAtThenId(a, b),
  );
  return eligible;
}

function replaceSnapshotRoot(snapshot: LauncherSnapshot, next: WorkRoot): void {
  const index = snapshot.issues.findIndex((issue) => issue.id === next.id);
  if (index >= 0) snapshot.issues[index] = next;
  snapshot.byId.set(next.id, next);
}

async function noteAutoStartFailure(
  root: WorkRoot,
  snapshot: LauncherSnapshot,
  message: string,
  clearOnly: boolean,
): Promise<void> {
  if (clearOnly) {
    await update(root.id, queueDeparturePatch());
    const {
      workQueuedAt: _workQueuedAt,
      workQueuePosition: _workQueuePosition,
      ...cleared
    } = root;
    replaceSnapshotRoot(snapshot, cleared);
    return;
  }
  const attentionReason = `Auto-start failed: ${message}`;
  await update(root.id, { needsAttention: true, attentionReason });
  replaceSnapshotRoot(snapshot, { ...root, needsAttention: true, attentionReason });
}

async function startQueuedRoot(
  root: WorkRoot,
  projectId: string,
  sessions: ConversationMessageSessions,
): Promise<void> {
  await startImplementingChannelSession(
    {
      projectId,
      issueId: root.id,
      title: implementingSessionTitle(root.title),
      message: implementingSessionMessage(root.id),
    },
    sessions,
  );
}

async function attemptStart(
  root: WorkRoot,
  projectId: string,
  snapshot: LauncherSnapshot,
  sessions: ConversationMessageSessions,
): Promise<"continue" | "stop"> {
  snapshot.attempted.add(root.id);
  try {
    await startQueuedRoot(root, projectId, sessions);
    return "continue";
  } catch (err) {
    // Another start took the last slot first; the root stays queued.
    if (err instanceof IssueError && err.code === "no-free-slot") return "stop";
    const message = err instanceof Error ? err.message : String(err);
    const conflict = err instanceof IssueError && err.status === 409;
    await noteAutoStartFailure(root, snapshot, message, conflict);
    return "continue";
  }
}

function stillStartable(
  rankedIds: readonly string[],
  snapshot: LauncherSnapshot,
): WorkRoot[] {
  const startable: WorkRoot[] = [];
  for (const id of rankedIds) {
    const issue = snapshot.byId.get(id);
    if (issue?.kind !== "epic" && issue?.kind !== "story") continue;
    if (!canStart(issue, snapshot)) continue;
    startable.push(issue);
  }
  return startable;
}

/**
 * Prefer a startable queued root that already holds a slot over one that
 * still needs a free slot.
 */
function nextQueuedStart(
  rankedIds: readonly string[],
  projectId: string,
  snapshot: LauncherSnapshot,
  cap: number,
): WorkRoot | undefined {
  const held = slotHoldingRootIds(projectId, snapshot);
  const startable = stillStartable(rankedIds, snapshot);
  const retry = startable.find((root) => held.has(root.id));
  if (retry) return retry;
  if (held.size >= cap) return undefined;
  return startable.find((root) => !held.has(root.id));
}

async function drainProject(
  project: Extract<Issue, { kind: "project" }>,
  snapshot: LauncherSnapshot,
  sessions: ConversationMessageSessions,
): Promise<void> {
  const rankedIds = startableQueuedRoots(project.id, snapshot).map((root) => root.id);
  for (;;) {
    const root = nextQueuedStart(
      rankedIds,
      project.id,
      snapshot,
      project.maxImplementingRuns,
    );
    if (!root) return;
    if ((await attemptStart(root, project.id, snapshot, sessions)) === "stop") {
      return;
    }
  }
}

/**
 * One launcher pass: archive the sessions of finished work roots, then drain
 * queued work roots while each Project has a free slot.
 * `list()` is synchronous and scans the whole store, so a pass bails on a raw
 * read when nothing is queued and no implementing session is open, and
 * otherwise derives at most once.
 */
export async function runLauncherPass(
  sessions: ConversationMessageSessions,
): Promise<void> {
  // No HTTP caller. Throwing is caught and written as auto-start failure,
  // which would mutate the copied queue, so guest mode skips the pass.
  if (guestRefusesAgentLaunch()) return;
  if (!hasQueuedWork(readAll().issues) && !hasOpenImplementingSession()) return;
  await drainPlanQueue(sessions);
  const { issues, derived } = list();
  const snapshot: LauncherSnapshot = {
    issues,
    derived,
    byId: new Map(issues.map((issue) => [issue.id, issue])),
    attempted: new Set(),
  };
  await releaseFinishedSlots(snapshot);
  const projects = issues.filter(
    (issue): issue is Extract<Issue, { kind: "project" }> =>
      issue.kind === "project",
  );
  for (const project of projects) {
    await drainProject(project, snapshot, sessions);
  }
}

const DRAIN_DEBOUNCE_MS = 500;

let draining: Promise<void> | null = null;
let again = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function isQueueRelevantFrame(frame: ConversationFrame): boolean {
  const scope = (frame.event as { scope?: unknown }).scope;
  return scope !== "comments" && scope !== "attachments";
}

function scheduleDebouncedDrain(sessions: AgentSessions): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    scheduleDrain(sessions);
  }, DRAIN_DEBOUNCE_MS);
}

function scheduleDrain(sessions: AgentSessions): void {
  if (draining) {
    again = true;
    return;
  }
  draining = (async () => {
    do {
      again = false;
      try {
        await runLauncherPass(sessions);
      } catch (err) {
        console.error("work queue launcher failed:", err);
      }
    } while (again);
  })().finally(() => {
    draining = null;
  });
}

/** Drain once at boot, then on each issues watcher frame. */
export function startWorkQueueLauncher(sessions: AgentSessions): void {
  subscribeFrames(ISSUES_TOPIC, (frame) => {
    if (isQueueRelevantFrame(frame)) scheduleDebouncedDrain(sessions);
  });
  startIssueEventsWatcher();
  scheduleDrain(sessions);
}
