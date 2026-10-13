import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { reviewRuntimesDir } from "../config.js";
import { isSlugSafe } from "../slug.js";
import { IssueError } from "./errors.js";
import { runtimeProcessSchema, runtimeProcessesLive, type RuntimeProcess } from "./runtime-boot.js";

/**
 * Disk record and in-memory boot for a review-owned runtime. Worktree sync
 * reads busy state from here and does not import the boot service.
 */

const reviewRuntimeRecordSchema = z.object({
  reviewId: z.string().min(1),
  worktree: z.string().min(1),
  phase: z.enum(["booting", "running", "failed"]),
  startedAt: z.string().min(1),
  processes: z.array(runtimeProcessSchema),
  port: z.number().int().positive().optional(),
  auxPort: z.number().int().positive().optional(),
  dataDir: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

export type ReviewRuntimeRecord = z.infer<typeof reviewRuntimeRecordSchema>;

export interface LiveBoot {
  worktree: string;
  process?: RuntimeProcess;
}

const liveBoots = new Map<string, LiveBoot>();

export function peekLiveBoot(reviewId: string): LiveBoot | undefined {
  return liveBoots.get(reviewId);
}

export function rememberLiveBoot(reviewId: string, boot: LiveBoot): void {
  liveBoots.set(reviewId, boot);
}

export function takeLiveBoot(reviewId: string): LiveBoot | undefined {
  const boot = liveBoots.get(reviewId);
  liveBoots.delete(reviewId);
  return boot;
}

export function liveBootIsCurrent(reviewId: string, boot: LiveBoot): boolean {
  return liveBoots.get(reviewId) === boot;
}

export function clearLiveBootIfCurrent(reviewId: string, boot: LiveBoot): void {
  if (liveBoots.get(reviewId) === boot) liveBoots.delete(reviewId);
}

export function reviewRuntimeDir(reviewId: string): string {
  if (!isSlugSafe(reviewId)) {
    throw new IssueError("validation", `review "${reviewId}" is not a slug`);
  }
  return join(reviewRuntimesDir, reviewId);
}

function recordPath(reviewId: string): string {
  return join(reviewRuntimeDir(reviewId), "state.json");
}

export function readReviewRuntimeRecord(reviewId: string): ReviewRuntimeRecord | null {
  const path = recordPath(reviewId);
  if (!existsSync(path)) return null;
  const parsed = reviewRuntimeRecordSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`invalid review runtime state at ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function writeReviewRuntimeRecord(record: ReviewRuntimeRecord): void {
  const dir = reviewRuntimeDir(record.reviewId);
  mkdirSync(dir, { recursive: true });
  const path = recordPath(record.reviewId);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, path);
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

/** True when a review runtime booted from this checkout is still starting or live. */
export function reviewRuntimeBusy(worktree: string): boolean {
  for (const boot of liveBoots.values()) {
    if (samePath(boot.worktree, worktree)) return true;
  }
  if (!existsSync(reviewRuntimesDir)) return false;
  for (const entry of readdirSync(reviewRuntimesDir)) {
    if (!isSlugSafe(entry)) continue;
    const dir = join(reviewRuntimesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const record = readReviewRuntimeRecord(entry);
    if (!record || record.phase === "failed" || !samePath(record.worktree, worktree)) continue;
    if (runtimeProcessesLive(record.processes)) return true;
  }
  return false;
}
