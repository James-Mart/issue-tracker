import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { vi } from "vitest";
import type { AgentStreamEvent } from "./agent-sdk.js";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import { resetDelegationConcurrencyForTests } from "./delegate-tool.js";

export let agentsDir: string;
export let storeDir: string;
export let cwd: string;

export function writeAgent(name: string, content: string): void {
  writeFileSync(join(agentsDir, name), content, "utf8");
}

export const ASSISTANT_STREAM: AgentStreamEvent[] = [
  {
    kind: "message",
    message: {
      type: "assistant",
      agent_id: "agent-nested",
      run_id: "run-nested",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "On it." }],
      },
    },
  },
];

export const NESTED_RUN_IDS = {
  agent_id: "agent-nested",
  run_id: "run-nested",
} as const;

export const CONTROL_ONLY_STREAM: AgentStreamEvent[] = [
  {
    kind: "message",
    message: {
      type: "request",
      ...NESTED_RUN_IDS,
      request_id: "req-1",
    },
  },
  {
    kind: "message",
    message: {
      type: "status",
      ...NESTED_RUN_IDS,
      status: "RUNNING",
    },
  },
  {
    kind: "message",
    message: {
      type: "usage",
      ...NESTED_RUN_IDS,
      usage: {
        inputTokens: 1,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 1,
      },
    },
  },
];

export function holdAfterStream(): { hold: Promise<void>; release: () => void } {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { hold, release };
}

export function setupDelegateToolTest(): void {
  agentsDir = mkdtempSync(join(tmpdir(), "issue-delegate-agents-"));
  storeDir = mkdtempSync(join(tmpdir(), "issue-delegate-store-"));
  cwd = mkdtempSync(join(tmpdir(), "issue-delegate-cwd-"));
  mkdirSync(agentsDir, { recursive: true });

  writeAgent(
    "pinned-role.md",
    `---
name: pinned-role
model: cursor-grok-4.5-high-fast
description: A pinned role for delegate tests.
---

You are the pinned role.

Follow the checklist.`,
  );
}

export function teardownDelegateToolTest(): void {
  resetDelegationConcurrencyForTests();
  rmSync(agentsDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
}

export async function waitForHandleSend(
  fake: ReturnType<typeof createFakeAgentSdk>,
  handleIndex: number,
): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (fake.handles[handleIndex]?.sends.length === 1) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for handle[${handleIndex}] send`);
}

export const NESTED_RUN_PUBLISH_AT = "2026-07-25T12:00:00.000Z";

export let nestedRunPublishRoot: string;
export let nestedRunIssuesRoot: string;
export let nestedRunWorkspaceDir: string;

export function setupNestedRunPublishTest(): void {
  // Nest issues/ under a unique root so conversations/ is not shared at
  // tmpdir()/conversations with other parallel Vitest workers.
  nestedRunPublishRoot = mkdtempSync(join(tmpdir(), "issue-delegate-publish-"));
  nestedRunIssuesRoot = join(nestedRunPublishRoot, "issues");
  mkdirSync(nestedRunIssuesRoot, { recursive: true });
  nestedRunWorkspaceDir = mkdtempSync(join(tmpdir(), "issue-delegate-ws-"));
  mkdirSync(join(nestedRunWorkspaceDir, ".git"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", nestedRunIssuesRoot);
  mkdirSync(join(nestedRunIssuesRoot, "platform"), { recursive: true });
  writeFileSync(
    join(nestedRunIssuesRoot, "platform", "issue.json"),
    JSON.stringify({
      id: "platform",
      kind: "project",
      title: "Platform",
      workspace: nestedRunWorkspaceDir,
      createdAt: NESTED_RUN_PUBLISH_AT,
      updatedAt: NESTED_RUN_PUBLISH_AT,
    }),
  );
}

export function teardownNestedRunPublishTest(): void {
  resetDelegationConcurrencyForTests();
  vi.unstubAllEnvs();
  rmSync(nestedRunPublishRoot, { recursive: true, force: true });
  rmSync(nestedRunWorkspaceDir, { recursive: true, force: true });
}

export async function loadNestedRunPublishModules() {
  const { createConversation, readConversation, readDelegations, updateMeta } =
    await import("./conversations.js");
  const { conversationsDir } = await import("../config.js");
  const { subscribeFrames } = await import("./conversation-stream.js");
  const { createDelegateCustomTools: createTools } = await import(
    "./delegate-tool.js"
  );
  return {
    createConversation,
    readConversation,
    readDelegations,
    updateMeta,
    conversationsDir,
    subscribeFrames,
    createDelegateCustomTools: createTools,
  };
}
