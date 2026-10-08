import { trackerGuest } from "../config.js";
import type { Issue, IssueEvent } from "../schemas.js";
import { isReadyToLandStory } from "../../src/features/issues/lib/derived.js";
import {
  subscribeFrames,
  type ConversationFrame,
} from "./conversation-stream.js";
import { derive, type DeriveResult } from "./derive.js";
import { ISSUES_TOPIC, startIssueEventsWatcher } from "./issue-events.js";
import { readAll } from "./issues.js";
import {
  reconcileProjectPrs,
  type PrReconcileResult,
} from "./pr-reconcile.js";
import { projectContaining, subtreeIds } from "./subtree.js";

/** Epic cadence: one pass at boot, then every five minutes. */
export const PR_SYNC_CADENCE_MS = 5 * 60 * 1000;

/**
 * Store-change triggers collapse per Project. Short relative to the cadence,
 * long enough that a burst of issue writes is one pass.
 */
export const PR_SYNC_STORE_DEBOUNCE_MS = 500;

export type PrSyncStatus = {
  lastSyncedAt?: string;
  lastError?: { message: string; at: string };
};

/** Result a pass step returns. `error` ends the pass. */
export type PrSyncStepResult = Pick<PrReconcileResult, "error" | "matches">;

/**
 * A step after `reconcileProjectPrs`. `previous` is that reconcile result
 * for the first registered step, and the prior step's result after that.
 */
export type PrSyncStep = (
  projectId: string,
  previous: PrSyncStepResult,
) => Promise<PrSyncStepResult>;

type StorySignal = {
  readyToLand: boolean;
  hasPrUrl: boolean;
};

const steps: PrSyncStep[] = [];
const statuses = new Map<string, PrSyncStatus>();
const baselines = new Map<string, Map<string, StorySignal>>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const tails = new Map<string, Promise<PrSyncStepResult>>();

let unsubscribe: (() => void) | null = null;
let cadenceTimer: ReturnType<typeof setInterval> | null = null;

/** Append a pass step. It runs after reconcile and sees the previous result. */
export function registerPrSyncStep(step: PrSyncStep): void {
  steps.push(step);
}

export function prSyncStatus(projectId: string): PrSyncStatus {
  const status = statuses.get(projectId);
  if (!status) return {};
  return {
    ...(status.lastSyncedAt ? { lastSyncedAt: status.lastSyncedAt } : {}),
    ...(status.lastError ? { lastError: { ...status.lastError } } : {}),
  };
}

/**
 * One Project's sync pass. Reconcile runs first; registered steps follow in
 * order, each handed the previous result. A returned `error` or a throw
 * stops the pass. Passes for one Project queue behind the one already running.
 */
export function runSyncPass(projectId: string): Promise<PrSyncStepResult> {
  const previous = tails.get(projectId) ?? Promise.resolve();
  // Failures resolve as `{ error }`, so the next pass stays on this chain.
  const run = previous.then(() => executeSyncPass(projectId));
  tails.set(projectId, run);
  return run;
}

/**
 * Boot-time driver. A guest server or an agent verification stack does not
 * run passes. Otherwise one pass per Project with a workspace, then every
 * `PR_SYNC_CADENCE_MS`, plus a debounced pass when a Story becomes ready to
 * land or gains a `prUrl`.
 */
export function startPrSyncDriver(): void {
  if (!syncPassesRunHere()) return;
  if (cadenceTimer) return;
  captureBaselines();
  unsubscribe = subscribeFrames(ISSUES_TOPIC, onIssuesFrame);
  startIssueEventsWatcher();
  passWorkspaceProjects();
  cadenceTimer = setInterval(passWorkspaceProjects, PR_SYNC_CADENCE_MS);
}

/** @internal Drop driver state between tests. */
export async function resetPrSyncDriverForTests(): Promise<void> {
  if (cadenceTimer) clearInterval(cadenceTimer);
  cadenceTimer = null;
  unsubscribe?.();
  unsubscribe = null;
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  await Promise.allSettled([...tails.values()]);
  tails.clear();
  baselines.clear();
  statuses.clear();
  steps.length = 0;
}

function syncPassesRunHere(): boolean {
  if (trackerGuest) return false;
  // The verification stack injects this into the server it boots.
  const port = process.env.AGENT_STACK_PORT;
  return port === undefined || port === "";
}

async function executeSyncPass(projectId: string): Promise<PrSyncStepResult> {
  const at = new Date().toISOString();
  try {
    let result: PrSyncStepResult = await reconcileProjectPrs(projectId);
    if (!result.error) {
      for (const step of [...steps]) {
        result = await step(projectId, result);
        if (result.error) break;
      }
    }
    if (result.error) {
      recordError(projectId, result.error, at);
      console.error(`pr sync failed for ${projectId}: ${result.error}`);
      return result;
    }
    recordSuccess(projectId, at);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(projectId, message, at);
    console.error(`pr sync failed for ${projectId}:`, err);
    return { error: message };
  }
}

function recordSuccess(projectId: string, at: string): void {
  statuses.set(projectId, { lastSyncedAt: at });
}

function recordError(projectId: string, message: string, at: string): void {
  const prior = statuses.get(projectId);
  statuses.set(projectId, {
    ...(prior?.lastSyncedAt ? { lastSyncedAt: prior.lastSyncedAt } : {}),
    lastError: { message, at },
  });
}

function passWorkspaceProjects(): void {
  for (const projectId of workspaceProjectIds()) runSyncPass(projectId);
}

function projectHasWorkspace(
  issue: Issue | undefined,
): issue is Extract<Issue, { kind: "project" }> {
  return issue?.kind === "project" && Boolean(issue.workspace?.trim());
}

function workspaceProjectIds(issues?: Issue[]): string[] {
  const list = issues ?? readAll().issues;
  return list
    .filter((issue) => projectHasWorkspace(issue))
    .map((issue) => issue.id)
    .sort((a, b) => a.localeCompare(b));
}

function captureBaselines(): void {
  const { issues } = readAll();
  const derived = derive(issues);
  baselines.clear();
  for (const projectId of workspaceProjectIds(issues)) {
    baselines.set(projectId, signalsFor(projectId, issues, derived.byId));
  }
}

function onIssuesFrame(frame: ConversationFrame): void {
  const event = frame.event as IssueEvent;
  if (event.scope !== "issue") return;
  const { issues } = readAll();
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const projectId = projectIdOf(event.id, byId);
  if (!projectId || !projectHasWorkspace(byId.get(projectId))) return;
  const existing = debounceTimers.get(projectId);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    projectId,
    setTimeout(() => {
      debounceTimers.delete(projectId);
      if (projectTriggered(projectId)) runSyncPass(projectId);
    }, PR_SYNC_STORE_DEBOUNCE_MS),
  );
}

function projectIdOf(
  issueId: string,
  byId: Map<string, Issue>,
): string | undefined {
  const issue = byId.get(issueId);
  if (!issue) return undefined;
  if (issue.kind === "project") return issue.id;
  return projectContaining(issue, byId);
}

function projectTriggered(projectId: string): boolean {
  const { issues } = readAll();
  const project = issues.find((issue) => issue.id === projectId);
  if (!projectHasWorkspace(project)) {
    baselines.delete(projectId);
    return false;
  }
  const derived = derive(issues);
  const next = signalsFor(projectId, issues, derived.byId);
  const prev = baselines.get(projectId);
  let triggered = false;
  for (const [storyId, signal] of next) {
    const before = prev?.get(storyId);
    const gainedPrUrl = signal.hasPrUrl && !before?.hasPrUrl;
    const becameReady = signal.readyToLand && !before?.readyToLand;
    if (gainedPrUrl || becameReady) triggered = true;
  }
  baselines.set(projectId, next);
  return triggered;
}

function signalsFor(
  projectId: string,
  issues: Issue[],
  derived: DeriveResult["byId"],
): Map<string, StorySignal> {
  const ids = subtreeIds(issues, projectId);
  const signals = new Map<string, StorySignal>();
  for (const issue of issues) {
    if (issue.kind !== "story" || !ids.has(issue.id)) continue;
    signals.set(issue.id, {
      readyToLand: isReadyToLandStory(issue, derived[issue.id], issues),
      hasPrUrl: Boolean(issue.prUrl),
    });
  }
  return signals;
}
