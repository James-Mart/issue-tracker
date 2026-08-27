import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { conversationsDir } from "../config.js";
import { isSlugSafe } from "../slug.js";

const mockupStackStateSchema = z.object({
  port: z.number().int().positive(),
  pid: z.number().int().positive(),
  /**
   * `/proc/<pid>/stat` start time. Pins the pid to the process we spawned, so a
   * recycled pid in state left behind by a crash does not read as owned.
   */
  startTime: z.string().min(1),
  baseUrl: z.string().min(1),
  startedAt: z.string().min(1),
});

export type MockupStackState = z.infer<typeof mockupStackStateSchema>;

function assertConversationId(conversationId: string): void {
  if (!isSlugSafe(conversationId)) {
    throw new Error(
      `mockup scratch conversationId must be a slug, got ${JSON.stringify(conversationId)}`,
    );
  }
}

function assertDirectionId(directionId: string): void {
  if (!isSlugSafe(directionId)) {
    throw new Error(
      `mockup scratch directionId must be a slug, got ${JSON.stringify(directionId)}`,
    );
  }
}

function metaPathFor(id: string): string {
  return join(conversationsDir, id, "meta.json");
}

function conversationIdForAgentId(agentId: string): string | null {
  if (!existsSync(conversationsDir)) return null;
  for (const entry of readdirSync(conversationsDir)) {
    const entryPath = join(conversationsDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    const metaPath = join(entryPath, "meta.json");
    if (!existsSync(metaPath)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      continue;
    }
    if (
      typeof raw === "object" &&
      raw !== null &&
      "agentId" in raw &&
      raw.agentId === agentId
    ) {
      return entry;
    }
  }
  return null;
}

/**
 * Map a conversation id or owning agent id to the conversation directory name
 * used for mockup scratch.
 */
export function resolveMockupConversationId(id: string): string {
  assertConversationId(id);
  const directMetaPath = metaPathFor(id);
  if (existsSync(directMetaPath)) {
    return id;
  }
  const mapped = conversationIdForAgentId(id);
  if (mapped !== null) {
    return mapped;
  }
  throw new Error(
    `mockup scratch id ${JSON.stringify(id)} did not resolve: looked for ${directMetaPath} and scanned ${join(conversationsDir, "*", "meta.json")} for agentId === ${JSON.stringify(id)}`,
  );
}

/** Peer of the conversation's `agent-stack/`. */
export function mockupScratchDir(conversationId: string): string {
  const resolvedId = resolveMockupConversationId(conversationId);
  const dir = join(conversationsDir, resolvedId, "mockups");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function directionDir(
  conversationId: string,
  directionId: string,
): string {
  assertDirectionId(directionId);
  const dir = join(mockupScratchDir(conversationId), directionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const MOCKUP_STACK_DIR = "mockup-stack";

/** Lists direction directory names under the conversation scratch (excludes mockup-stack). */
export function listDirectionIds(conversationId: string): string[] {
  const resolvedId = resolveMockupConversationId(conversationId);
  const scratch = join(conversationsDir, resolvedId, "mockups");
  if (!existsSync(scratch)) return [];
  return readdirSync(scratch)
    .filter((name) => {
      if (name === MOCKUP_STACK_DIR) return false;
      const entryPath = join(scratch, name);
      return statSync(entryPath).isDirectory();
    })
    .sort();
}

/** Removes every direction directory except `keepDirectionId`. */
export function pruneDirections(
  conversationId: string,
  keepDirectionId: string,
): string[] {
  const resolvedId = resolveMockupConversationId(conversationId);
  assertDirectionId(keepDirectionId);
  const scratch = join(conversationsDir, resolvedId, "mockups");
  const keepPath = join(scratch, keepDirectionId);
  if (!existsSync(keepPath) || !statSync(keepPath).isDirectory()) {
    throw new Error(
      `mockup scratch has no direction ${JSON.stringify(keepDirectionId)} for conversation ${JSON.stringify(conversationId)}`,
    );
  }

  const removed: string[] = [];
  for (const name of readdirSync(scratch)) {
    if (name === keepDirectionId || name === MOCKUP_STACK_DIR) continue;
    const entryPath = join(scratch, name);
    if (!statSync(entryPath).isDirectory()) continue;
    rmSync(entryPath, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

/** Canonical harness config at the scratch root; does not create the file. */
export function harnessConfigPath(conversationId: string): string {
  const resolvedId = resolveMockupConversationId(conversationId);
  return join(conversationsDir, resolvedId, "mockups", "harness.json");
}

/** Peer of the conversation's `mockups/` scratch. */
export function mockupStackDir(conversationId: string): string {
  const resolvedId = resolveMockupConversationId(conversationId);
  return join(conversationsDir, resolvedId, "mockups", "mockup-stack");
}

export function mockupStackStatePath(conversationId: string): string {
  return join(mockupStackDir(conversationId), "state.json");
}

export function mockupStackLogPath(conversationId: string): string {
  return join(mockupStackDir(conversationId), "storybook.log");
}

export function readMockupStackState(
  conversationId: string,
): MockupStackState | null {
  const path = mockupStackStatePath(conversationId);
  if (!existsSync(path)) return null;
  const parsed = mockupStackStateSchema.safeParse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (!parsed.success) {
    throw new Error(
      `invalid mockup-stack state at ${path}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export function writeMockupStackState(
  conversationId: string,
  state: MockupStackState,
): void {
  const parsed = mockupStackStateSchema.parse(state);
  const path = mockupStackStatePath(conversationId);
  mkdirSync(mockupStackDir(conversationId), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
}
