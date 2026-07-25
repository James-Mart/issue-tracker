import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent } from "./agent-sdk.js";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import type { ConversationFrame } from "./conversation-stream.js";
import {
  createDelegateCustomTools,
  NESTED_RUN_HEARTBEAT_MS,
} from "./delegate-tool.js";
import {
  formatEffectiveModel,
  resolveModelSelection,
} from "./model-selection.js";
import { loadRoleBody } from "./role-bodies.js";

let agentsDir: string;
let storeDir: string;
let cwd: string;

function writeAgent(name: string, content: string): void {
  writeFileSync(join(agentsDir, name), content, "utf8");
}

const ASSISTANT_STREAM: AgentStreamEvent[] = [
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

beforeEach(() => {
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
});

afterEach(() => {
  rmSync(agentsDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("createDelegateCustomTools", () => {
  it("creates a nested agent on the role's mapped pin with the role body prepended", async () => {
    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    const roleBody = loadRoleBody("pinned-role", agentsDir);
    const result = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "do the thing" },
      {},
    );

    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]!.model).toEqual(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    expect(fake.handles[0]!.sends).toHaveLength(1);
    expect(fake.handles[0]!.sends[0]!.prompt.startsWith(roleBody)).toBe(true);
    expect(fake.handles[0]!.sends[0]!.prompt.endsWith("do the thing")).toBe(
      true,
    );
    expect(result).toEqual({
      agentId: fake.handles[0]!.agentId,
      reply: "On it.",
    });
  });

  it("passes the same delegate tool to nested agents and handles nested delegation", async () => {
    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "outer work" },
      {},
    );

    const nestedTools = fake.created[0]!.customTools;
    expect(nestedTools).toBeDefined();
    expect(nestedTools!.delegate).toBe(customTools.delegate);

    const nestedResult = await nestedTools!.delegate!.execute(
      { role: "pinned-role", prompt: "inner work" },
      {},
    );

    expect(fake.created).toHaveLength(2);
    expect(fake.created[1]!.customTools?.delegate).toBe(customTools.delegate);
    expect(fake.created[1]!.model).toEqual(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    expect(nestedResult).toEqual({
      agentId: fake.handles[1]!.agentId,
      reply: "On it.",
    });
    expect(nestedResult.agentId).not.toBe(fake.handles[0]!.agentId);
  });
});

describe("delegate publishes nested run frames", () => {
  let issuesRoot: string;
  let workspaceDir: string;

  const AT = "2026-07-25T12:00:00.000Z";

  beforeEach(() => {
    issuesRoot = mkdtempSync(join(tmpdir(), "issue-delegate-publish-"));
    workspaceDir = mkdtempSync(join(tmpdir(), "issue-delegate-ws-"));
    mkdirSync(join(workspaceDir, ".git"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesRoot);
    mkdirSync(join(issuesRoot, "platform"), { recursive: true });
    writeFileSync(
      join(issuesRoot, "platform", "issue.json"),
      JSON.stringify({
        id: "platform",
        kind: "project",
        title: "Platform",
        workspace: workspaceDir,
        createdAt: AT,
        updatedAt: AT,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(issuesRoot, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  async function load() {
    const { createConversation, readConversation } = await import(
      "./conversations.js"
    );
    const { subscribeFrames } = await import("./conversation-stream.js");
    const { createDelegateCustomTools: createTools } = await import(
      "./delegate-tool.js"
    );
    return {
      createConversation,
      readConversation,
      subscribeFrames,
      createDelegateCustomTools: createTools,
    };
  }

  async function waitForSend(
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

  it("emits subagent_update frames with delegationId and effective model", async () => {
    const {
      createConversation,
      readConversation,
      subscribeFrames,
      createDelegateCustomTools: createTools,
    } = await load();
    const meta = await createConversation({
      title: "Delegate publish",
      projectId: "platform",
      model: "composer-2.5",
    });

    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    const frames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      frames.push(frame);
    });

    await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "publish me" },
      { toolCallId: "call-delegate-1" },
    );
    unsubscribe();

    const expectedModel = formatEffectiveModel(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    const nested = frames.filter(
      (f): f is ConversationFrame & { event: { type: "subagent_update" } } =>
        f.event.type === "subagent_update",
    );
    expect(nested.length).toBeGreaterThan(0);
    expect(
      nested.every(
        (f) =>
          f.event.parentCallId === "call-delegate-1" &&
          typeof f.event.delegationId === "string" &&
          f.event.delegationId.length > 0 &&
          f.event.model === expectedModel &&
          f.event.parentDelegationId === undefined,
      ),
    ).toBe(true);

    const { transcript } = readConversation(meta.id);
    const persisted = transcript.filter((e) => e.type === "subagent_update");
    expect(persisted.length).toBeGreaterThan(0);
    expect(
      persisted.every((e) => e.delegationId && e.model === expectedModel),
    ).toBe(true);
  });

  it("records the outer run as parentDelegationId for a nested delegation", async () => {
    const {
      createConversation,
      subscribeFrames,
      createDelegateCustomTools: createTools,
    } = await load();
    const meta = await createConversation({
      title: "Nested parentage",
      projectId: "platform",
      model: "composer-2.5",
    });

    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeAgentSdk({ hold, stream: ASSISTANT_STREAM });
    const customTools = createTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    const frames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      frames.push(frame);
    });

    const outerPromise = customTools.delegate!.execute(
      { role: "pinned-role", prompt: "outer" },
      { toolCallId: "call-outer" },
    );
    await waitForSend(fake, 0);

    // Start the inner run while the outer is still on the delegation stack
    // (held mid-stream). Both sends share the fake's hold, so await them
    // only after release.
    const innerPromise = customTools.delegate!.execute(
      { role: "pinned-role", prompt: "inner" },
      { toolCallId: "call-inner" },
    );
    await waitForSend(fake, 1);

    release();
    await Promise.all([outerPromise, innerPromise]);
    unsubscribe();

    const byParent = (callId: string) =>
      frames.filter(
        (f): f is ConversationFrame & { event: { type: "subagent_update" } } =>
          f.event.type === "subagent_update" &&
          f.event.parentCallId === callId,
      );

    const outerFrames = byParent("call-outer");
    const innerFrames = byParent("call-inner");
    expect(outerFrames.length).toBeGreaterThan(0);
    expect(innerFrames.length).toBeGreaterThan(0);

    const outerDelegationId = outerFrames[0]!.event.delegationId;
    expect(outerDelegationId).toEqual(expect.any(String));
    expect(
      outerFrames.every((f) => f.event.parentDelegationId === undefined),
    ).toBe(true);
    expect(
      innerFrames.every(
        (f) => f.event.parentDelegationId === outerDelegationId,
      ),
    ).toBe(true);
    expect(innerFrames[0]!.event.delegationId).not.toBe(outerDelegationId);
  });

  it("emits live-only liveness heartbeats for a silent in-flight nested run", async () => {
    vi.useFakeTimers();
    try {
      const {
        createConversation,
        readConversation,
        subscribeFrames,
        createDelegateCustomTools: createTools,
      } = await load();
      const meta = await createConversation({
        title: "Liveness heartbeat",
        projectId: "platform",
        model: "composer-2.5",
      });

      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fake = createFakeAgentSdk({ hold, stream: [] });
      const customTools = createTools({
        sdk: fake,
        cwd,
        storeDir,
        agentsDir,
        conversationId: meta.id,
      });

      const frames: ConversationFrame[] = [];
      const unsubscribe = subscribeFrames(meta.id, (frame) => {
        frames.push(frame);
      });

      const executePromise = customTools.delegate!.execute(
        { role: "pinned-role", prompt: "stay quiet" },
        { toolCallId: "call-silent" },
      );

      for (let i = 0; i < 50; i++) {
        if (fake.handles[0]?.sends.length === 1) break;
        await Promise.resolve();
      }
      expect(fake.handles[0]?.sends.length).toBe(1);

      await vi.advanceTimersByTimeAsync(NESTED_RUN_HEARTBEAT_MS);
      await vi.advanceTimersByTimeAsync(NESTED_RUN_HEARTBEAT_MS);

      const livenessDuring = frames.filter(
        (
          f,
        ): f is ConversationFrame & {
          event: {
            type: "subagent_update";
            step: { kind: "liveness"; elapsedMs: number };
          };
        } =>
          f.event.type === "subagent_update" &&
          f.event.step.kind === "liveness",
      );
      expect(livenessDuring.length).toBeGreaterThanOrEqual(2);
      expect(livenessDuring.every((f) => f.persist === false)).toBe(true);
      expect(
        livenessDuring.every(
          (f) =>
            f.event.parentCallId === "call-silent" &&
            typeof f.event.delegationId === "string" &&
            f.event.delegationId.length > 0,
        ),
      ).toBe(true);
      const elapsed = livenessDuring.map((f) => f.event.step.elapsedMs);
      for (let i = 1; i < elapsed.length; i++) {
        expect(elapsed[i]!).toBeGreaterThan(elapsed[i - 1]!);
      }

      const countAtRelease = livenessDuring.length;
      release();
      await executePromise;
      unsubscribe();

      await vi.advanceTimersByTimeAsync(NESTED_RUN_HEARTBEAT_MS * 3);
      const livenessAfter = frames.filter(
        (f) =>
          f.event.type === "subagent_update" &&
          f.event.step.kind === "liveness",
      );
      expect(livenessAfter.length).toBe(countAtRelease);

      const { transcript } = readConversation(meta.id);
      expect(
        transcript.some(
          (e) =>
            e.type === "subagent_update" && e.step.kind === "liveness",
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
