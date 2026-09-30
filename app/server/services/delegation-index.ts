import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { z } from "zod";
import { conversationsDir } from "../config.js";
import type { DelegationRecord } from "../schemas.js";
import { conversationExists, readableConversationIds } from "./conversation-ids.js";
import { readDelegationLines } from "./delegation-log.js";
import { IssueError } from "./errors.js";

const delegationLocationSchema = z.object({
  conversationId: z.string().min(1),
  parentCallId: z.string().min(1),
  issueId: z.string().min(1),
});

const delegationIndexSchema = z.record(
  z.string().min(1),
  delegationLocationSchema,
);

export type DelegationLocation = z.infer<typeof delegationLocationSchema>;

let cache: { path: string; map: Map<string, DelegationLocation> } | null = null;

function indexPath(): string {
  return join(dirname(conversationsDir), "delegation-index.json");
}

function writeIndex(
  map: Map<string, DelegationLocation>,
): Map<string, DelegationLocation> {
  const path = indexPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(Object.fromEntries(map), null, 2)}\n`);
  cache = { path, map };
  return map;
}

function readIndex(path: string): Map<string, DelegationLocation> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new IssueError("validation", `invalid delegation index: ${detail}`);
  }
  const parsed = delegationIndexSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new IssueError("validation", `invalid delegation index: ${detail}`);
  }
  return new Map(Object.entries(parsed.data));
}

/**
 * First conversation in directory order keeps a duplicate id. That is the
 * conversation the pre-index scan returned.
 */
function buildIndex(): Map<string, DelegationLocation> {
  const index = new Map<string, DelegationLocation>();
  for (const conversationId of readableConversationIds()) {
    for (const line of readDelegationLines(conversationId)) {
      if (line.kind !== "start") continue;
      const { delegationId, issueId, parentCallId } = line.record;
      if (!issueId || !parentCallId) continue;
      if (index.has(delegationId)) continue;
      index.set(delegationId, {
        conversationId,
        parentCallId,
        issueId,
      });
    }
  }
  return index;
}

function ensureIndex(): Map<string, DelegationLocation> {
  const path = indexPath();
  if (cache && cache.path === path && existsSync(path)) return cache.map;
  if (!existsSync(path)) return writeIndex(buildIndex());
  const map = readIndex(path);
  cache = { path, map };
  return map;
}

/** Owning conversation for a delegation id, or absent when none was recorded. */
export function resolveDelegation(
  delegationId: string,
): DelegationLocation | undefined {
  const located = ensureIndex().get(delegationId);
  // A stale index entry must not recreate a deleted conversation's run-events dir.
  if (!located || !conversationExists(located.conversationId)) return undefined;
  return located;
}

/**
 * Record a start line. A missing index is built from delegations already on
 * disk (including this line). An id already present keeps its first owner.
 * An end write passes the start record when one exists, and still builds a
 * missing index when it does not.
 */
export function recordDelegation(
  conversationId: string,
  record?: DelegationRecord,
): void {
  const index = ensureIndex();
  if (!record?.issueId || !record.parentCallId) return;
  if (index.has(record.delegationId)) return;
  const next = new Map(index);
  next.set(record.delegationId, {
    conversationId,
    parentCallId: record.parentCallId,
    issueId: record.issueId,
  });
  writeIndex(next);
}

/** Drop index entries for a conversation that has been deleted. */
export function forgetConversationDelegations(conversationId: string): void {
  if (!existsSync(indexPath())) return;
  const index = ensureIndex();
  const next = new Map(index);
  let changed = false;
  for (const [id, location] of index) {
    if (location.conversationId !== conversationId) continue;
    next.delete(id);
    changed = true;
  }
  if (changed) writeIndex(next);
}
