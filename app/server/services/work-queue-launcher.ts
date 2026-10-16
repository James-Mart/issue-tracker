import type { Issue } from "../schemas.js";
import type { AgentSessions } from "./agent-sessions.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import { derive } from "./derive.js";
import {
  subscribeFrames,
  type ConversationFrame,
} from "./conversation-stream.js";
import { archiveConversation, type BusyLookup } from "./conversations.js";
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

/** A busy session is skipped; the pass after its run settles archives it. */
async function releaseFinishedSlots(
  snapshot: SlotSnapshot,
  sessions: BusyLookup,
): Promise<void> {
  for (const conversationId of finishedRootSessionIds(snapshot)) {
    try {
      await archiveConversation(conversationId, sessions);
    } catch (err) {
      if (err instanceof IssueError && err.code === "conflict") continue;
      throw err;
    }
  }
}

function queuePosition(root: WorkRoot): number {
  if (root.workQueuePosition === undefined) {
    throw new Error(`queued work root "${root.id}" has no workQueuePosition`);
  }
  return root.workQueuePosition;
}

function canStart(root: WorkRoot, snapshot: LauncherSnapshot): boolean {
  if (
    !root.workQueuedAt ||
    root.workParkedAt ||
    snapshot.attempted.has(root.id) ||
    root.needsAttention
  ) {
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
      workParkedAt: _workParkedAt,
      workResumeNote: _workResumeNote,
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
      message: implementingSessionMessage(root.id, root.workResumeNote),
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
async function runLauncherPass(
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
  await releaseFinishedSlots(snapshot, sessions);
  const projects = issues.filter(
    (issue): issue is Extract<Issue, { kind: "project" }> =>
      issue.kind === "project",
  );
  for (const project of projects) {
    await drainProject(project, snapshot, sessions);
  }
}

const DRAIN_DEBOUNCE_MS = 500;

type PendingPass = { finished: Promise<void>; resolve: () => void };

let draining = false;
let pendingPass: PendingPass | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function isQueueRelevantFrame(frame: ConversationFrame): boolean {
  const scope = (frame.event as { scope?: unknown }).scope;
  return scope !== "comments" && scope !== "attachments";
}

function scheduleDebouncedDrain(sessions: AgentSessions): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void drainWorkQueue(sessions);
  }, DRAIN_DEBOUNCE_MS);
}

function requestPass(): PendingPass {
  if (!pendingPass) {
    let resolve!: () => void;
    const finished = new Promise<void>((done) => {
      resolve = done;
    });
    pendingPass = { finished, resolve };
  }
  return pendingPass;
}

async function runDrain(sessions: ConversationMessageSessions): Promise<void> {
  draining = true;
  while (pendingPass) {
    const pass = pendingPass;
    pendingPass = null;
    try {
      await runLauncherPass(sessions);
    } catch (err) {
      console.error("work queue launcher failed:", err);
    }
    pass.resolve();
  }
  // Cleared in the same tick as the loop's last check, so no request can land
  // between them and go unrun.
  draining = false;
}

/**
 * Run launcher passes one at a time. A call made while a pass is in flight
 * asks for one more pass after it. Resolves once a pass that began after the
 * call has finished; a failed pass is logged and still resolves.
 */
export function drainWorkQueue(
  sessions: ConversationMessageSessions,
): Promise<void> {
  const { finished } = requestPass();
  if (!draining) void runDrain(sessions);
  return finished;
}

/** Drain once at boot, then on each issues watcher frame and each run settle. */
export function startWorkQueueLauncher(sessions: AgentSessions): void {
  subscribeFrames(ISSUES_TOPIC, (frame) => {
    if (isQueueRelevantFrame(frame)) scheduleDebouncedDrain(sessions);
  });
  sessions.onRunSettled(() => scheduleDebouncedDrain(sessions));
  startIssueEventsWatcher();
  void drainWorkQueue(sessions);
}
