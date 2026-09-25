import { readAgentModelSlugCatalog } from "../agent-model-slugs.js";
import { modelSlugCatalogPath } from "../config.js";
import type { Issue, IssuePatch, IssuesResponse } from "../schemas.js";
import { FAKE_MODELS } from "./agent-sdk.fake.js";
import type { AgentSessions } from "./agent-sessions.js";
import {
  subscribeFrames,
  type ConversationFrame,
} from "./conversation-stream.js";
import {
  createIssueChannelSession,
  listConversations,
  startConversationPrompt,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import {
  implementingSessionMessage,
  implementingSessionModel,
  implementingSessionTitle,
} from "./implementing-launch.js";
import { ISSUES_TOPIC, startIssueEventsWatcher } from "./issue-events.js";
import { list, readAll, update } from "./issues.js";
import { drainPlanQueue } from "./plan-queue-launcher.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { projectContaining } from "./subtree.js";

type WorkRoot = Extract<Issue, { kind: "epic" | "story" }>;

function listedModels(): { id: string; displayName: string }[] {
  const disk = readAgentModelSlugCatalog(modelSlugCatalogPath);
  if (disk && disk.models.length > 0) return disk.models;
  return FAKE_MODELS;
}

function countActiveImplementingRuns(
  projectId: string,
  sessions: AgentSessions,
): number {
  let count = 0;
  for (const meta of listConversations()) {
    if (meta.archived || meta.channel !== "implementing") continue;
    if (meta.projectId !== projectId) continue;
    if (sessions.getActiveRun(meta.id) === undefined) continue;
    count += 1;
  }
  return count;
}

type LauncherSnapshot = {
  issues: Issue[];
  derived: IssuesResponse["derived"];
  byId: Map<string, Issue>;
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

function oldestEligibleRoot(
  projectId: string,
  snapshot: LauncherSnapshot,
): WorkRoot | undefined {
  const { issues, derived, byId, attempted } = snapshot;
  const eligible: WorkRoot[] = [];
  for (const issue of issues) {
    if (issue.kind !== "epic" && issue.kind !== "story") continue;
    if (!issue.workQueuedAt || attempted.has(issue.id)) continue;
    if (projectContaining(issue, byId) !== projectId) continue;
    const state = derived[issue.id];
    if (!state || state.blocked || state.planNotFinal) continue;
    eligible.push(issue);
  }
  eligible.sort((a, b) => a.workQueuedAt!.localeCompare(b.workQueuedAt!));
  return eligible[0];
}

async function noteAutoStartFailure(
  rootId: string,
  message: string,
  clearOnly: boolean,
): Promise<void> {
  const patch: IssuePatch = { workQueuedAt: null };
  if (!clearOnly) {
    patch.needsAttention = true;
    patch.attentionReason = `Auto-start failed: ${message}`;
  }
  await update(rootId, patch);
}

async function startQueuedRoot(
  root: WorkRoot,
  projectId: string,
  sessions: AgentSessions,
): Promise<void> {
  requireProjectWorkspace(projectId);
  const model = implementingSessionModel(listedModels());
  if (!model) {
    throw new Error("no coordinator model is available");
  }
  const title = implementingSessionTitle(root.title);
  const message = implementingSessionMessage(root.id);
  const { meta, initialPrompt } = await createIssueChannelSession(
    {
      projectId,
      title,
      model,
      issueId: root.id,
      channel: "implementing",
      message,
    },
    sessions,
  );
  if (!initialPrompt) return;
  const started = await startConversationPrompt(
    meta.id,
    initialPrompt,
    model,
    sessions,
    { persistPrompt: false },
  );
  if (!started.ok) {
    throw new Error(started.message);
  }
}

async function drainProject(
  project: Extract<Issue, { kind: "project" }>,
  snapshot: LauncherSnapshot,
  sessions: AgentSessions,
): Promise<void> {
  const cap = project.maxImplementingRuns;
  while (countActiveImplementingRuns(project.id, sessions) < cap) {
    const root = oldestEligibleRoot(project.id, snapshot);
    if (!root) return;
    snapshot.attempted.add(root.id);
    try {
      await startQueuedRoot(root, project.id, sessions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const conflict = err instanceof IssueError && err.status === 409;
      await noteAutoStartFailure(root.id, message, conflict);
    }
  }
}

/**
 * One launcher pass: drain queued work roots up to each Project's cap.
 * `list()` is synchronous and scans the whole store, so a pass bails on a raw
 * read when nothing is queued and otherwise derives at most once.
 */
export async function runLauncherPass(sessions: AgentSessions): Promise<void> {
  if (!hasQueuedWork(readAll().issues)) return;
  await drainPlanQueue(sessions);
  const { issues, derived } = list();
  const snapshot: LauncherSnapshot = {
    issues,
    derived,
    byId: new Map(issues.map((issue) => [issue.id, issue])),
    attempted: new Set(),
  };
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
