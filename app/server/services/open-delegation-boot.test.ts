import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import {
  agentsDir,
  cwd,
  holdAfterStream,
  setupDelegateToolTest,
  storeDir,
  teardownDelegateToolTest,
  waitForHandleSend,
} from "./delegate-tool.fixtures.js";

const AT = "2026-07-25T12:00:00.000Z";

let issuesRoot: string;
let issuesDir: string;

function seedPlatformIssue(): void {
  mkdirSync(join(issuesDir, "platform"), { recursive: true });
  writeFileSync(
    join(issuesDir, "platform", "issue.json"),
    JSON.stringify({
      id: "platform",
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    }),
  );
}

async function loadModules() {
  const { refreshStorePathsFromEnv } = await import("../config.js");
  refreshStorePathsFromEnv();
  const conversations = await import("./conversations.js");
  const boot = await import("./open-delegation-boot.js");
  return { ...conversations, ...boot };
}

beforeEach(() => {
  vi.resetModules();
  issuesRoot = mkdtempSync(join(tmpdir(), "open-del-boot-"));
  issuesDir = join(issuesRoot, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.stubEnv("ISSUES_DIR", issuesDir);
  seedPlatformIssue();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(issuesRoot, { recursive: true, force: true });
});

describe("open delegation boot reconciliation", () => {
  it("closes every open delegation with host-process-died before listen", async () => {
    const {
      createConversation,
      appendDelegation,
      appendDelegationEnd,
      readDelegations,
      closeOpenDelegationsAtBoot,
    } = await loadModules();

    const meta = await createConversation({
      title: "Boot close",
      projectId: "platform",
      model: "composer-2.5",
    });
    await appendDelegation(meta.id, {
      delegationId: "del-open-1",
      agentId: "agent-1",
      role: "pinned-role",
      model: "auto",
    });
    await appendDelegation(meta.id, {
      delegationId: "del-open-2",
      agentId: "agent-2",
      role: "pinned-role",
      model: "auto",
    });
    await appendDelegation(meta.id, {
      delegationId: "del-closed",
      agentId: "agent-3",
      role: "pinned-role",
      model: "auto",
    });
    await appendDelegationEnd(meta.id, {
      delegationId: "del-closed",
      status: "completed",
    });

    const beforeClose = Date.now();
    await closeOpenDelegationsAtBoot();
    const afterClose = Date.now();

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(3);

    const openOne = records.find((r) => r.delegationId === "del-open-1");
    const openTwo = records.find((r) => r.delegationId === "del-open-2");
    const closed = records.find((r) => r.delegationId === "del-closed");

    for (const record of [openOne, openTwo]) {
      expect(record?.end).toMatchObject({
        status: "error",
        failureClass: "host-process-died",
      });
      const endedAtMs = Date.parse(record!.end!.endedAt);
      expect(endedAtMs).toBeGreaterThanOrEqual(beforeClose);
      expect(endedAtMs).toBeLessThanOrEqual(afterClose);
    }

    expect(closed?.end).toMatchObject({
      status: "completed",
    });
    expect(closed?.end).not.toHaveProperty("failureClass");
  });

  it("logs one failed conversation and still closes the rest", async () => {
    const { conversationsDir } = await import("../config.js");
    const {
      createConversation,
      appendDelegation,
      readDelegations,
      closeOpenDelegationsAtBoot,
    } = await loadModules();

    const good = await createConversation({
      title: "Good",
      projectId: "platform",
      model: "composer-2.5",
    });
    await appendDelegation(good.id, {
      delegationId: "del-good",
      agentId: "agent-good",
      role: "pinned-role",
      model: "auto",
    });

    const badId = "conv-malformed-meta";
    mkdirSync(join(conversationsDir, badId), { recursive: true });
    writeFileSync(join(conversationsDir, badId, "meta.json"), "{not json");
    writeFileSync(
      join(conversationsDir, badId, "delegations.jsonl"),
      `${JSON.stringify({
        delegationId: "del-bad",
        agentId: "agent-bad",
        role: "pinned-role",
        model: "auto",
        lifecycle: "tracked",
        at: AT,
      })}\n`,
    );

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(closeOpenDelegationsAtBoot()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(badId),
      expect.anything(),
    );
    expect(readDelegations(good.id)[0]?.end).toMatchObject({
      status: "error",
      failureClass: "host-process-died",
    });
    error.mockRestore();
  });
});

describe("agent-facing failure-class contract", () => {
  it("names host-process-died on the delegate tool without retry or stop guidance", async () => {
    setupDelegateToolTest();
    try {
      const fake = createFakeAgentSdk({ stream: [] });
      const { createDelegateCustomTools } = await import("./delegate-tool.js");
      const customTools = createDelegateCustomTools({
        sdk: fake,
        cwd,
        storeDir,
        agentsDir,
        conversationId: "conv-contract",
      });
      const description = customTools.delegate!.description ?? "";
      expect(description).toContain("host-process-died");
      expect(description).not.toMatch(/host-process-died[^)]*retry/i);
      expect(description).not.toMatch(/host-process-died[^)]*do not/i);
    } finally {
      teardownDelegateToolTest();
    }
  });
});

describe("running delegation after boot", () => {
  beforeEach(() => {
    setupDelegateToolTest();
  });

  afterEach(() => {
    teardownDelegateToolTest();
  });

  it("leaves a live delegation without an end record", async () => {
    const { hold, release } = holdAfterStream();
    const fake = createFakeAgentSdk({ hold, stream: [] });
    const { createConversation, readDelegations } = await loadModules();
    const { createDelegateCustomTools } = await import("./delegate-tool.js");

    const meta = await createConversation({
      title: "Live delegation",
      projectId: "platform",
      model: "composer-2.5",
    });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    const running = customTools.delegate!.execute(
      { role: "pinned-role", prompt: "still running" },
      {},
    );
    await waitForHandleSend(fake, 0);

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(1);
    expect(records[0]).not.toHaveProperty("end");

    release();
    await running;
  });
});
