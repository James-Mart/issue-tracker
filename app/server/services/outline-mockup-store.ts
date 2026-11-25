import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { outlineMockupsDir } from "../config.js";
import { isSlugSafe } from "../slug.js";
import { isRecordedProcessLive, readProcInfo } from "./storybook-process.js";

/**
 * On-disk state for one outline's mockups, outside the issues store:
 *
 * ```
 * outline-mockups/<outlineId>/
 *   tree/             replay tree: shared harness.json + package.json, one folder per direction, node_modules
 *   storybook/        state.json, storybook.log, heap-reports/ for the one Storybook process
 *   leases/           one <leaseId>.json per held viewer or capture lease
 *   captures/         PNGs from the latest capture run
 *   author-run.json   the mockup author's last reported run state
 *   session.json      the conversation bound to this outline's Storybook
 *   stack-failure.json  the last install or Storybook start that failed
 * ```
 */

const LOCK_POLL_MS = 100;

const holderSchema = z.object({
  pid: z.number().int().positive(),
  startTime: z.string().min(1),
});

export type ProcessHolder = z.infer<typeof holderSchema>;

export const AUTHOR_RUN_STATES = ["running", "failed", "clean"] as const;
export type AuthorRunState = (typeof AUTHOR_RUN_STATES)[number];

const authorRunSchema = z.object({
  state: z.enum(AUTHOR_RUN_STATES),
  at: z.string().min(1),
});

const sessionSchema = z.object({ conversationId: z.string().min(1) });

const stackFailureSchema = z.object({
  command: z.string().min(1).optional(),
  outputTail: z.string(),
});

export type OutlineStackFailure = z.infer<typeof stackFailureSchema>;

const leaseSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["viewer", "capture"]),
  /** Capture leases end with their process; the viewer lease ends only on release. */
  holder: holderSchema.optional(),
  acquiredAt: z.string().min(1),
});

export type OutlineLease = z.infer<typeof leaseSchema>;

const storybookStateSchema = z.object({
  port: z.number().int().positive(),
  pid: z.number().int().positive(),
  startTime: z.string().min(1),
  baseUrl: z.string().min(1),
  /** Public prefix Storybook was started under; null when no session was bound. */
  base: z.string().min(1).nullable(),
  startedAt: z.string().min(1),
});

export type OutlineStorybookState = z.infer<typeof storybookStateSchema>;

function assertOutlineId(outlineId: string): void {
  if (!isSlugSafe(outlineId)) {
    throw new Error(`outline id must be a slug, got ${JSON.stringify(outlineId)}`);
  }
}

export function outlineMockupsRoot(outlineId: string): string {
  assertOutlineId(outlineId);
  return join(outlineMockupsDir, outlineId);
}

export function replayTreeDir(outlineId: string): string {
  return join(outlineMockupsRoot(outlineId), "tree");
}

export function outlineStorybookDir(outlineId: string): string {
  return join(outlineMockupsRoot(outlineId), "storybook");
}

export function outlineStorybookLogPath(outlineId: string): string {
  return join(outlineStorybookDir(outlineId), "storybook.log");
}

export function outlineCapturesDir(outlineId: string): string {
  return join(outlineMockupsRoot(outlineId), "captures");
}

function leasesDir(outlineId: string): string {
  return join(outlineMockupsRoot(outlineId), "leases");
}

function readRecord<T>(path: string, schema: z.ZodType<T>): T | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`invalid outline mockup record at ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

function writeRecord(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function currentProcessHolder(): ProcessHolder {
  const info = readProcInfo(process.pid);
  if (!info) throw new Error(`cannot read /proc/${process.pid}/stat`);
  return { pid: process.pid, startTime: info.startTime };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The lock file appears whole: the holder is written beside it and hard-linked into place. */
function tryCreateLockFile(path: string, holder: ProcessHolder): boolean {
  const pending = `${path}.${holder.pid}`;
  writeFileSync(pending, `${JSON.stringify(holder)}\n`);
  try {
    linkSync(pending, path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    return false;
  } finally {
    rmSync(pending, { force: true });
  }
}

async function acquireLockFile(path: string, holder: ProcessHolder): Promise<void> {
  mkdirSync(join(path, ".."), { recursive: true });
  for (;;) {
    if (tryCreateLockFile(path, holder)) return;
    const current = readRecord(path, holderSchema);
    if (current === null) continue;
    if (!isRecordedProcessLive(current)) {
      rmSync(path, { force: true });
      continue;
    }
    await delay(LOCK_POLL_MS);
  }
}

/**
 * Cross-process mutex for one outline's mockup state. Not reentrant: a
 * second acquire from the same process waits like any other holder.
 */
export async function withOutlineMockupsLock<T>(
  outlineId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const path = join(outlineMockupsRoot(outlineId), ".lock");
  await acquireLockFile(path, currentProcessHolder());
  try {
    return await fn();
  } finally {
    rmSync(path, { force: true });
  }
}

/**
 * Hold every outline's mockup lock until `fn` finishes. Locks are nested in
 * id order so the earlier ones stay acquired; taking them one after another
 * would release each before the next.
 */
export function withOutlineMockupsLocks<T>(
  outlineIds: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const ids = [...new Set(outlineIds)].sort();
  const run = (index: number): Promise<T> => {
    const id = ids[index];
    if (id === undefined) return fn();
    return withOutlineMockupsLock(id, () => run(index + 1));
  };
  return run(0);
}

/** A missing record means no author run has edited the tree since it last matched the bundles. */
export function readAuthorRunState(outlineId: string): AuthorRunState {
  const path = join(outlineMockupsRoot(outlineId), "author-run.json");
  return readRecord(path, authorRunSchema)?.state ?? "clean";
}

export function writeAuthorRunState(outlineId: string, state: AuthorRunState): void {
  const path = join(outlineMockupsRoot(outlineId), "author-run.json");
  writeRecord(path, { state, at: new Date().toISOString() });
}

export function readBoundSession(outlineId: string): string | null {
  const path = join(outlineMockupsRoot(outlineId), "session.json");
  return readRecord(path, sessionSchema)?.conversationId ?? null;
}

export function writeBoundSession(outlineId: string, conversationId: string): void {
  writeRecord(join(outlineMockupsRoot(outlineId), "session.json"), { conversationId });
}

export function readStackFailure(outlineId: string): OutlineStackFailure | null {
  return readRecord(join(outlineMockupsRoot(outlineId), "stack-failure.json"), stackFailureSchema);
}

export function writeStackFailure(outlineId: string, failure: OutlineStackFailure): void {
  writeRecord(join(outlineMockupsRoot(outlineId), "stack-failure.json"), failure);
}

export function removeStackFailure(outlineId: string): void {
  rmSync(join(outlineMockupsRoot(outlineId), "stack-failure.json"), { force: true });
}

/** The outline whose Storybook a conversation is bound to, if any. */
export function outlineForBoundSession(conversationId: string): string | null {
  if (!existsSync(outlineMockupsDir)) return null;
  for (const outlineId of readdirSync(outlineMockupsDir).sort()) {
    if (!isSlugSafe(outlineId)) continue;
    if (readBoundSession(outlineId) === conversationId) return outlineId;
  }
  return null;
}

export function readOutlineStorybookState(outlineId: string): OutlineStorybookState | null {
  return readRecord(join(outlineStorybookDir(outlineId), "state.json"), storybookStateSchema);
}

export function writeOutlineStorybookState(
  outlineId: string,
  state: OutlineStorybookState,
): void {
  writeRecord(
    join(outlineStorybookDir(outlineId), "state.json"),
    storybookStateSchema.parse(state),
  );
}

export function removeOutlineStorybookState(outlineId: string): void {
  rmSync(join(outlineStorybookDir(outlineId), "state.json"), { force: true });
}

/** Lease ids carry their outline so release needs nothing else. */
export function leaseOutlineId(leaseId: string): string {
  const outlineId = leaseId.split(".")[0] ?? "";
  if (!isSlugSafe(outlineId) || !leaseId.startsWith(`${outlineId}.`)) {
    throw new Error(`unknown lease ${JSON.stringify(leaseId)}`);
  }
  return outlineId;
}

function leasePath(outlineId: string, leaseId: string): string {
  return join(leasesDir(outlineId), `${leaseId}.json`);
}

export function writeLease(outlineId: string, lease: OutlineLease): void {
  writeRecord(leasePath(outlineId, lease.id), leaseSchema.parse(lease));
}

export function removeLease(outlineId: string, leaseId: string): boolean {
  const path = leasePath(outlineId, leaseId);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/** Held leases, dropping capture leases whose process is gone. */
export function liveLeases(outlineId: string): OutlineLease[] {
  const dir = leasesDir(outlineId);
  if (!existsSync(dir)) return [];
  const leases: OutlineLease[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const lease = readRecord(join(dir, name), leaseSchema);
    if (!lease) continue;
    if (lease.holder && !isRecordedProcessLive(lease.holder)) {
      rmSync(join(dir, name), { force: true });
      continue;
    }
    leases.push(lease);
  }
  return leases;
}
