import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import type { CaptureResult } from "./mockup-story-capture.js";

export const mockCaptureMockupStoryStates = vi.fn();

vi.mock("./mockup-capture.js", () => ({
  captureMockupStoryStates: (...args: unknown[]) =>
    mockCaptureMockupStoryStates(...args),
}));

export const AT = "2026-07-09T14:00:00.000Z";

export let root: string;
export let issuesDir: string;

export function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

export function seedIssues(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("src", {
    kind: "idea",
    title: "Source",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("dst", {
    kind: "idea",
    title: "Dest",
    partOf: "p",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
}

export async function loadPromote() {
  return import("./mockup-promote.js");
}

export async function loadScratch() {
  return import("./mockup-scratch.js");
}

export async function loadAttachments() {
  return import("./attachments.js");
}

export async function loadConversationAttachments() {
  return import("./conversation-attachments.js");
}

export async function loadConfig() {
  return import("../config.js");
}

export function writeConversationMeta(
  conversationsDir: string,
  conversationId: string,
  overrides: { agentId?: string } = {},
): void {
  const dir = join(conversationsDir, conversationId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      id: conversationId,
      title: conversationId,
      projectId: "p",
      model: "composer-2.5",
      createdAt: AT,
      updatedAt: AT,
      archived: false,
      ...overrides,
    }),
  );
}

export function writePng(path: string, marker: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.from(`png:${marker}`));
}

export function capture(
  storyId: string,
  viewport: "phone" | "desktop",
  absolutePath: string,
): CaptureResult {
  return { storyId, viewport, absolutePath };
}

export function useMockupPromoteTestFixtures(): void {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-promote-"));
    issuesDir = join(root, "issues");
    mkdirSync(issuesDir, { recursive: true });
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("ISSUES_DIR", issuesDir);
    seedIssues();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "promote-chat");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
}
