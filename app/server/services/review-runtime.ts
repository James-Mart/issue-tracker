import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ReviewRuntimeStatus } from "../schemas/review.js";
import type { Runtime } from "../schemas.js";
import { loadPhaseSecrets } from "./agent-stack-secrets.js";
import { killProcessGroup } from "./bounded-process.js";
import { IssueError } from "./errors.js";
import {
  assertGuestAllowsOutwardEffect,
  GUEST_REFUSED_REVIEW_RUNTIME_START,
  GUEST_REFUSED_REVIEW_RUNTIME_STOP,
} from "./guest-outward-effects.js";
import { readAll, readReviewOrThrow } from "./issues.js";
import {
  clearLiveBootIfCurrent,
  liveBootIsCurrent,
  peekLiveBoot,
  readReviewRuntimeRecord,
  rememberLiveBoot,
  reviewRuntimeDir,
  takeLiveBoot,
  writeReviewRuntimeRecord,
  type LiveBoot,
  type ReviewRuntimeRecord,
} from "./review-runtime-occupancy.js";
import {
  allocateRuntimeResources,
  bootRuntime,
  discardRuntimeDataDir,
  missingDeclaredRuntimeFields,
  RuntimeBootAborted,
  runtimeProcessesLive,
  stopRuntimeProcesses,
  type RuntimeProcess,
  type RuntimeResources,
} from "./runtime-boot.js";

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
    return { state: "failed", error: record.error ?? "Runtime failed to start." };
  }
  const inflight = peekLiveBoot(reviewId) !== undefined;
  const live = runtimeProcessesLive(record.processes);
  if (record.phase === "running" && live && record.baseUrl) {
    return { state: "running", baseUrl: record.baseUrl };
  }
  if (record.phase === "booting" && (inflight || live)) return { state: "booting" };
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

function trackedProcesses(
  record: ReviewRuntimeRecord | null,
  boot: LiveBoot | undefined,
): RuntimeProcess[] {
  const processes = [...(record?.processes ?? [])];
  if (
    boot?.process &&
    !processes.some(
      (proc) => proc.pid === boot.process?.pid && proc.startTime === boot.process.startTime,
    )
  ) {
    processes.push(boot.process);
  }
  return processes;
}

async function discardExisting(reviewId: string): Promise<void> {
  const boot = takeLiveBoot(reviewId);
  const record = readReviewRuntimeRecord(reviewId);
  const processes = trackedProcesses(record, boot);
  if (processes.length > 0) {
    await stopRuntimeProcesses(processes, `review runtime ${reviewId}`);
  }
  rmSync(reviewRuntimeDir(reviewId), { recursive: true, force: true });
}

async function runBoot(reviewId: string, boot: LiveBoot, spec: BootSpec): Promise<void> {
  let resources: RuntimeResources | undefined;
  try {
    resources = await allocateRuntimeResources(reviewRuntimeDir(reviewId));
    const { port, auxPort, dataDir } = resources;
    const secrets = loadPhaseSecrets(spec.projectId);
    const booted = await bootRuntime({
      logDir: reviewRuntimeDir(reviewId),
      resources,
      worktree: spec.worktree,
      runtime: spec.runtime,
      secrets,
      label: "runtime",
      aborted: () => !liveBootIsCurrent(reviewId, boot),
      onSpawned: (process, baseUrl) => {
        if (!liveBootIsCurrent(reviewId, boot)) {
          killProcessGroup(process.pid, "SIGTERM");
          throw new RuntimeBootAborted();
        }
        boot.process = process;
        writeReviewRuntimeRecord({
          reviewId,
          worktree: spec.worktree,
          phase: "booting",
          startedAt: spec.startedAt,
          processes: [process],
          port,
          auxPort,
          dataDir,
          baseUrl,
        });
      },
    });
    if (!liveBootIsCurrent(reviewId, boot)) return;
    writeReviewRuntimeRecord({
      reviewId,
      worktree: spec.worktree,
      phase: "running",
      startedAt: spec.startedAt,
      processes: [booted.process],
      port,
      auxPort,
      dataDir,
      baseUrl: booted.baseUrl,
    });
  } catch (err) {
    if (err instanceof RuntimeBootAborted || !liveBootIsCurrent(reviewId, boot)) return;
    if (boot.process) {
      try {
        await stopRuntimeProcesses([boot.process], `review runtime ${reviewId}`);
      } catch (stopErr) {
        console.error(`review runtime ${reviewId} failed to stop after boot error:`, stopErr);
      }
    }
    if (resources) discardRuntimeDataDir(resources.dataDir);
    if (!liveBootIsCurrent(reviewId, boot)) return;
    writeReviewRuntimeRecord({
      reviewId,
      worktree: spec.worktree,
      phase: "failed",
      startedAt: spec.startedAt,
      processes: [],
      error: failureLine(err),
    });
  } finally {
    clearLiveBootIfCurrent(reviewId, boot);
  }
}

async function beginStart(reviewId: string): Promise<ReviewRuntimeStatus> {
  assertGuestAllowsOutwardEffect(GUEST_REFUSED_REVIEW_RUNTIME_START);
  const spec = requireBoot(reviewId);
  const current = observe(reviewId);
  if (current.state === "running") return current;
  if (current.state === "booting" && peekLiveBoot(reviewId)) return current;
  await discardExisting(reviewId);
  const boot: LiveBoot = { worktree: spec.worktree };
  rememberLiveBoot(reviewId, boot);
  writeReviewRuntimeRecord({
    reviewId,
    worktree: spec.worktree,
    phase: "booting",
    startedAt: spec.startedAt,
    processes: [],
  });
  void runBoot(reviewId, boot, spec).catch((err: unknown) => {
    console.error(`review runtime boot failed for ${reviewId}:`, err);
  });
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
  const boot = takeLiveBoot(reviewId);
  const record = readReviewRuntimeRecord(reviewId);
  const processes = trackedProcesses(record, boot);
  if (processes.length > 0) {
    await stopRuntimeProcesses(processes, `review runtime ${reviewId}`);
  }
  const worktree = record?.worktree ?? boot?.worktree;
  rmSync(reviewRuntimeDir(reviewId), { recursive: true, force: true });
  if (sync && worktree) await syncWorktree(worktree);
  return { state: "stopped" };
}

export function readReviewRuntime(reviewId: string): ReviewRuntimeStatus {
  readReviewOrThrow(reviewId);
  return observe(reviewId);
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
