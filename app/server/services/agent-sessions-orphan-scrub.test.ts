import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import type { AgentHandle, AgentSdk } from "./agent-sdk.js";
import { createFakeAgentSdk, type FakeAgentSdk } from "./agent-sdk.fake.js";
import {
  load,
  runLiveMarkerPath,
  storeDir,
  useAgentSessionsTestFixtures,
} from "./agent-sessions.test-harness.js";

useAgentSessionsTestFixtures();

const ACTIVE_RUN = "already has active run";

async function deadPid(): Promise<number> {
  const child = spawn("true", [], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("expected spawned pid");
  await new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
  return pid;
}

function writeNdjson(dir: string, name: string, rows: unknown[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
}

function readNdjson(dir: string, name: string): Record<string, unknown>[] {
  return readFileSync(join(dir, name), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Throws the SDK's active-run refusal when the store still names one. */
function activeRunMessage(dir: string): string | undefined {
  const path = join(dir, JSONL_LOCAL_AGENT_STORE_FILES.agents);
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as {
      agentId?: string;
      activeRunId?: unknown;
    };
    if (row.activeRunId != null) {
      return `Agent ${row.agentId ?? "unknown"} ${ACTIVE_RUN}`;
    }
  }
  return undefined;
}

function sdkThatRejectsActiveRun(inner: FakeAgentSdk): AgentSdk {
  function guard(dir: string): void {
    const message = activeRunMessage(dir);
    if (message) throw new Error(message);
  }
  function wrap(dir: string, handle: AgentHandle): AgentHandle {
    return {
      agentId: handle.agentId,
      async send(message, options) {
        guard(dir);
        return handle.send(message, options);
      },
      cancel: () => handle.cancel(),
      [Symbol.asyncDispose]: () => handle[Symbol.asyncDispose](),
    };
  }
  return {
    listModels: () => inner.listModels(),
    async createAgent(options) {
      guard(options.storeDir);
      return wrap(options.storeDir, await inner.createAgent(options));
    },
    async resumeAgent(agentId, dir, options) {
      guard(dir);
      return wrap(dir, await inner.resumeAgent(agentId, dir, options));
    },
    prewarmWorkspace: (cwd) => inner.prewarmWorkspace(cwd),
  };
}

async function seedOrphan(title: string): Promise<{ id: string; dir: string }> {
  const { createConversation } = await load();
  const meta = await createConversation({
    title,
    projectId: "platform",
    model: "auto",
    agentId: "agent-orphaned",
  });
  const dir = storeDir(meta.id);
  writeNdjson(dir, JSONL_LOCAL_AGENT_STORE_FILES.agents, [
    {
      agentId: "agent-orphaned",
      cwd: "/tmp/workspace",
      status: "running",
      activeRunId: "run-open",
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  writeNdjson(dir, JSONL_LOCAL_AGENT_STORE_FILES.runs, [
    {
      runId: "run-open",
      agentId: "agent-orphaned",
      turnNumber: 1,
      status: "running",
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  const pid = await deadPid();
  writeFileSync(
    runLiveMarkerPath(meta.id),
    `${JSON.stringify({ pid })}\n`,
  );
  return { id: meta.id, dir };
}

describe("scrub before resume or send", () => {
  it("scrubs an orphaned marker so resume and send run without an active run", async () => {
    const { createAgentSessions, readConversation } = await load();
    const { id } = await seedOrphan("Scrub then send");
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(sdkThatRejectsActiveRun(fake));

    const result = await sessions.sendPrompt(id, { prompt: "again" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    expect(fake.created).toHaveLength(0);
    expect(fake.resumed).toHaveLength(1);
    expect(fake.resumed[0]?.agentId).toBe("agent-orphaned");
    expect(fake.handles[0]?.sends).toEqual([{ message: "again", options: {} }]);
    expect(JSON.stringify(readConversation(id).transcript)).not.toContain(
      ACTIVE_RUN,
    );
    expect(
      readNdjson(storeDir(id), JSONL_LOCAL_AGENT_STORE_FILES.agents)[0],
    ).toMatchObject({ status: "idle", activeRunId: null });
  });
});
