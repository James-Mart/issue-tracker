import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ReviewRuntimeLog, ReviewRuntimeStatus } from "../schemas/review.js";
import type { Runtime } from "../schemas.js";
import { loadPhaseSecrets } from "./agent-stack-secrets.js";
import { IssueError } from "./errors.js";
import {
  assertGuestAllowsOutwardEffect,
  GUEST_REFUSED_REVIEW_RUNTIME_START,
  GUEST_REFUSED_REVIEW_RUNTIME_STOP,
} from "./guest-outward-effects.js";
import { readAll, readReviewOrThrow } from "./issues.js";
import {
  clearLiveBootIfCurrent,
  inFlightReviewRuntimeIds,
  peekLiveBoot,
  readReviewRuntimeRecord,
  rememberLiveBoot,
  reviewRuntimeDir,
  writeReviewRuntimeRecord,
  type LiveBoot,
} from "./review-runtime-occupancy.js";
import {
  allocateRuntimeResources,
  bootRuntime,
  discardRuntimeDataDir,
  missingDeclaredRuntimeFields,
  readRuntimeBootPhaseLogLines,
  RuntimeBootCancelled,
  runtimeBootPhaseLogBasename,
  runtimeProcessesLive,
  stopRuntimeProcesses,
  type RuntimeBootPhaseReport,
  type RuntimeProcess,
  type RuntimeResources,
} from "./runtime-boot.js";
import { settledValues } from "./settled-values.js";

export { reviewRuntimeBusy } from "./review-runtime-occupancy.js";

/**
 * A runtime the review workbench starts for manual checks. The record is keyed
 * by the review id and the process boots in that review's worktree.
 * Conversation agent stacks are a separate record and stay under the conversation.
 */

interface BootSpec {
  projectId: string;
  worktree: string;
  runtime: Runtime;
  startedAt: string;
}

const gates = new Map<string, Promise<void>>();

function withGate<T>(reviewId: string, fn: () => Promise<T>): Promise<T> {
  const prev = gates.get(reviewId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  gates.set(reviewId, tail);
  void tail.finally(() => {
    if (gates.get(reviewId) === tail) gates.delete(reviewId);
  });
  return run;
}

function failureLine(err: unknown): string {
  const message = err instanceof Error ? err.message : "Runtime failed to start.";
  const line = message.split("\n").find((item) => item.trim().length > 0)?.trim();
  return line ?? "Runtime failed to start.";
}

function observe(reviewId: string): ReviewRuntimeStatus {
  const record = readReviewRuntimeRecord(reviewId);
  if (!record) return { state: "stopped" };
  if (record.phase === "failed") {
    return {
      state: "failed",
      error: record.error ?? "Runtime failed to start.",
      failedPhase: record.bootPhase?.phase,
    };
  }
  const inflight = peekLiveBoot(reviewId) !== undefined;
  const live = runtimeProcessesLive(record.processes);
  if (record.phase === "running" && live && record.baseUrl) {
    return { state: "running", baseUrl: record.baseUrl };
  }
  if (record.phase === "booting" && (inflight || live)) {
    return {
      state: "booting",
      phase: record.bootPhase?.phase,
      phaseStartedAt: record.bootPhase?.startedAt,
    };
  }
  if (record.phase === "running") return { state: "failed", error: "Runtime exited." };
  return {
    state: "failed",
    error: record.error ?? "Runtime exited before it was ready.",
  };
}

function requireBoot(reviewId: string): BootSpec {
  const review = readReviewOrThrow(reviewId);
  if (review.archived) {
    throw new IssueError("validation", `review "${reviewId}" is archived`);
  }
  if (!review.worktreePath || !existsSync(review.worktreePath) || !statSync(review.worktreePath).isDirectory()) {
    throw new IssueError("validation", `review "${reviewId}" has no live worktree`);
  }
  const project = readAll().issues.find((issue) => issue.id === review.partOf);
  if (project?.kind !== "project") {
    throw new IssueError("validation", `review "${reviewId}" is not under a project`);
  }
  const missing = missingDeclaredRuntimeFields(project.runtime);
  if (!project.runtime || missing.length > 0) {
    throw new IssueError(
      "validation",
      `Project "${project.id}" runtime is missing ${missing.join(" and ")}`,
    );
  }
  return {
    projectId: project.id,
    worktree: resolve(review.worktreePath),
    runtime: project.runtime,
    startedAt: new Date().toISOString(),
  };
}

/** Remove the runtime like a stop, returning the worktree it booted in. */
async function discardRuntime(reviewId: string): Promise<string | undefined> {
  const boot = peekLiveBoot(reviewId);
  if (boot) {
    boot.controller.abort();
    // The boot writes the record until it settles, and its phase may still be
    // running in the worktree.
    await boot.settled;
  }
  const record = readReviewRuntimeRecord(reviewId);
  if (record && record.processes.length > 0) {
    await stopRuntimeProcesses(record.processes, `review runtime ${reviewId}`);
  }
  rmSync(reviewRuntimeDir(reviewId), { recursive: true, force: true });
  return record?.worktree ?? boot?.worktree;
}

async function runBoot(reviewId: string, spec: BootSpec, signal: AbortSignal): Promise<void> {
  let resources: RuntimeResources | undefined;
  let started: RuntimeProcess | undefined;
  let lastBootPhase: RuntimeBootPhaseReport | undefined;
  try {
    resources = await allocateRuntimeResources(reviewRuntimeDir(reviewId));
    const { port, auxPort, dataDir } = resources;
    const recordBase = {
      reviewId,
      worktree: spec.worktree,
      startedAt: spec.startedAt,
      port,
      auxPort,
      dataDir,
    };
    const secrets = loadPhaseSecrets(spec.projectId);
    const booted = await bootRuntime({
      logDir: reviewRuntimeDir(reviewId),
      resources,
      worktree: spec.worktree,
      runtime: spec.runtime,
      secrets,
      label: "runtime",
      signal,
      onPhase: (bootPhase) => {
        lastBootPhase = bootPhase;
        if (bootPhase.phase === "start") started = { role: "start", ...bootPhase.process };
        writeReviewRuntimeRecord({
          ...recordBase,
          phase: "booting",
          processes: started ? [started] : [],
          bootPhase,
        });
      },
    });
    writeReviewRuntimeRecord({
      ...recordBase,
      phase: "running",
      processes: [booted.process],
      baseUrl: booted.baseUrl,
    });
  } catch (err) {
    if (err instanceof RuntimeBootCancelled) return;
    if (started) {
      try {
        await stopRuntimeProcesses([started], `review runtime ${reviewId}`);
      } catch (stopErr) {
        console.error(`review runtime ${reviewId} failed to stop after boot error:`, stopErr);
      }
    }
    if (resources) discardRuntimeDataDir(resources.dataDir);
    writeReviewRuntimeRecord({
      reviewId,
      worktree: spec.worktree,
      phase: "failed",
      startedAt: spec.startedAt,
      processes: [],
      error: failureLine(err),
      bootPhase: lastBootPhase,
    });
  }
}

async function beginStart(reviewId: string): Promise<ReviewRuntimeStatus> {
  assertGuestAllowsOutwardEffect(GUEST_REFUSED_REVIEW_RUNTIME_START);
  const spec = requireBoot(reviewId);
  const current = observe(reviewId);
  if (current.state === "running") return current;
  if (current.state === "booting" && peekLiveBoot(reviewId)) return current;
  await discardRuntime(reviewId);
  writeReviewRuntimeRecord({
    reviewId,
    worktree: spec.worktree,
    phase: "booting",
    startedAt: spec.startedAt,
    processes: [],
  });
  const controller = new AbortController();
  const boot: LiveBoot = {
    worktree: spec.worktree,
    controller,
    settled: runBoot(reviewId, spec, controller.signal)
      .catch((err: unknown) => {
        console.error(`review runtime boot failed for ${reviewId}:`, err);
      })
      .finally(() => clearLiveBootIfCurrent(reviewId, boot)),
  };
  rememberLiveBoot(reviewId, boot);
  return { state: "booting" };
}

async function syncWorktree(worktree: string): Promise<void> {
  try {
    const { syncReviewsAtWorktree } = await import("./review-worktree-sync.js");
    await syncReviewsAtWorktree(worktree);
  } catch (err) {
    // Stop already removed the runtime. A failed sync must not fail the stop
    // or write the record back; the next sync retries from the checkout.
    console.error(`review worktree sync failed for ${worktree}:`, err);
  }
}

async function beginStop(
  reviewId: string,
  sync: boolean,
): Promise<ReviewRuntimeStatus> {
  assertGuestAllowsOutwardEffect(GUEST_REFUSED_REVIEW_RUNTIME_STOP);
  readReviewOrThrow(reviewId);
  const worktree = await discardRuntime(reviewId);
  if (sync && worktree) await syncWorktree(worktree);
  return { state: "stopped" };
}

export function readReviewRuntime(reviewId: string): ReviewRuntimeStatus {
  readReviewOrThrow(reviewId);
  return observe(reviewId);
}

export function readReviewRuntimeLog(reviewId: string): ReviewRuntimeLog {
  readReviewOrThrow(reviewId);
  const record = readReviewRuntimeRecord(reviewId);
  if (!record?.bootPhase) {
    throw new IssueError("not_found", `review runtime "${reviewId}" has no boot phase log`);
  }
  const phase = record.bootPhase.phase;
  const logDir = reviewRuntimeDir(reviewId);
  return {
    phase,
    log: runtimeBootPhaseLogBasename(phase),
    lines: readRuntimeBootPhaseLogLines(logDir, phase),
  };
}

export function startReviewRuntime(reviewId: string): Promise<ReviewRuntimeStatus> {
  return withGate(reviewId, () => beginStart(reviewId));
}

export function stopReviewRuntime(
  reviewId: string,
  options?: { syncWorktree?: boolean },
): Promise<ReviewRuntimeStatus> {
  return withGate(reviewId, () => beginStop(reviewId, options?.syncWorktree !== false));
}

function stopBootingReviewRuntime(
  reviewId: string,
): Promise<ReviewRuntimeStatus | undefined> {
  return withGate(reviewId, async () => {
    if (!peekLiveBoot(reviewId)) return undefined;
    const record = readReviewRuntimeRecord(reviewId);
    // `running` is written before the live boot is cleared. Stop would tear
    // that runtime down; shutdown leaves it up.
    if (record && record.phase !== "booting") return undefined;
    return beginStop(reviewId, true);
  });
}

/**
 * API shutdown. Cancels review runtimes still booting, through the same path
 * as Stop, and settles once each of those records and directories is gone.
 * A runtime that has reached running stays up.
 */
export function stopInFlightReviewRuntimesOnShutdown(): Promise<ReviewRuntimeStatus[]> {
  return settledValues(inFlightReviewRuntimeIds().map((id) => stopBootingReviewRuntime(id)));
}
