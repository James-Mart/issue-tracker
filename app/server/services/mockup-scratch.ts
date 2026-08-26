import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { conversationsDir } from "../config.js";
import { isSlugSafe } from "../slug.js";

const mockupStackStateSchema = z.object({
  port: z.number().int().positive(),
  pid: z.number().int().positive(),
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

/** Canonical harness config at the scratch root; does not create the file. */
export function harnessConfigPath(conversationId: string): string {
  assertConversationId(conversationId);
  return join(conversationsDir, conversationId, "mockups", "harness.json");
}

function mockupStackStatePath(conversationId: string): string {
  assertConversationId(conversationId);
  return join(
    conversationsDir,
    conversationId,
    "mockups",
    "mockup-stack",
    "state.json",
  );
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
  mkdirSync(join(mockupScratchDir(conversationId), "mockup-stack"), {
    recursive: true,
  });
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
}
