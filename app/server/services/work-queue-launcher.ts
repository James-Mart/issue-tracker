import { readAgentModelSlugCatalog } from "../agent-model-slugs.js";
import { modelSlugCatalogPath } from "../config.js";
import type { Issue, IssuePatch } from "../schemas.js";
import { FAKE_MODELS } from "./agent-sdk.fake.js";
import type { AgentSessions } from "./agent-sessions.js";
import { subscribeFrames } from "./conversation-stream.js";
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
import { list, update } from "./issues.js";
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

function oldestEligibleRoot(projectId: string): WorkRoot | undefined {
  const { issues, derived } = list();
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const eligible: WorkRoot[] = [];
  for (const issue of issues) {
    if (issue.kind !== "epic" && issue.kind !== "story") continue;
    if (!issue.workQueuedAt) continue;
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
  sessions: AgentSessions,
): Promise<void> {
  const cap = project.maxImplementingRuns;
  while (countActiveImplementingRuns(project.id, sessions) < cap) {
    const root = oldestEligibleRoot(project.id);
    if (!root) return;
    try {
      await startQueuedRoot(root, project.id, sessions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const conflict = err instanceof IssueError && err.status === 409;
      await noteAutoStartFailure(root.id, message, conflict);
    }
  }
}

/** One launcher pass: drain queued work roots up to each Project's cap. */
export async function runLauncherPass(sessions: AgentSessions): Promise<void> {
  await drainPlanQueue(sessions);
  const projects = list().issues.filter(
    (issue): issue is Extract<Issue, { kind: "project" }> =>
      issue.kind === "project",
  );
  for (const project of projects) {
    await drainProject(project, sessions);
  }
}

let draining: Promise<void> | null = null;
let again = false;

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
  subscribeFrames(ISSUES_TOPIC, () => {
    scheduleDrain(sessions);
  });
  startIssueEventsWatcher();
  scheduleDrain(sessions);
}
