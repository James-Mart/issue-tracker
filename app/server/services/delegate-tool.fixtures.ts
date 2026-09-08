import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
