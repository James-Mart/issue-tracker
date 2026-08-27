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

/** Peer of the conversation's `agent-stack/`. */
export function mockupScratchDir(conversationId: string): string {
  assertConversationId(conversationId);
  const dir = join(conversationsDir, conversationId, "mockups");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function directionDir(
  conversationId: string,
  directionId: string,
): string {
  assertConversationId(conversationId);
  assertDirectionId(directionId);
  const dir = join(mockupScratchDir(conversationId), directionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const MOCKUP_STACK_DIR = "mockup-stack";

/** Removes every direction directory except `keepDirectionId`. */
export function pruneDirections(
  conversationId: string,
  keepDirectionId: string,
): string[] {
  assertConversationId(conversationId);
  assertDirectionId(keepDirectionId);
  const scratch = join(conversationsDir, conversationId, "mockups");
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
  assertConversationId(conversationId);
  return join(conversationsDir, conversationId, "mockups", "harness.json");
}

/** Peer of the conversation's `mockups/` scratch. */
export function mockupStackDir(conversationId: string): string {
  assertConversationId(conversationId);
  return join(conversationsDir, conversationId, "mockups", "mockup-stack");
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
  assertConversationId(conversationId);
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
  assertConversationId(conversationId);
  const parsed = mockupStackStateSchema.parse(state);
  const path = mockupStackStatePath(conversationId);
  mkdirSync(mockupStackDir(conversationId), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
}
