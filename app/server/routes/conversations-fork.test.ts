import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import type { Server } from "http";
import { join } from "path";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { TranscriptEvent } from "../schemas/conversation.js";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
} from "../services/agent-sdk.fake.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import {
  baseUrl,
  conversationsDir,
  useConversationsTestFixtures,
} from "./conversations.test-harness.js";

useConversationsTestFixtures();

const AT_T1 = "2026-07-09T14:00:00.000Z";
const AT_T1_END = "2026-07-09T14:00:05.000Z";
const AT_T2 = "2026-07-09T14:01:00.000Z";
const AT_T2_MID = "2026-07-09T14:01:30.000Z";

const T1_MS = Date.parse(AT_T1);
const T1_END_MS = Date.parse(AT_T1_END);
const T2_MS = Date.parse(AT_T2);

const SOURCE_AGENT = "agent-source";

function conversationDir(id: string): string {
  return join(conversationsDir(), id);
}

function conversationFingerprint(id: string): Map<string, Buffer> {
  const dir = conversationDir(id);
  const fingerprint = new Map<string, Buffer>();

  function walk(relDir: string): void {
    const abs = join(dir, relDir);
    if (!existsSync(abs)) return;
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const rel = relDir ? join(relDir, ent.name) : ent.name;
      const path = join(dir, rel);
      if (ent.isDirectory()) {
        walk(rel);
      } else if (ent.isFile()) {
        fingerprint.set(rel, readFileSync(path));
      }
    }
  }

  walk("");
  return fingerprint;
}

function runRow(
  overrides: Record<string, unknown> & { runId: string; agentId: string },
): Record<string, unknown> {
  const now = overrides.updatedAt ?? 1;
  return {
    turnNumber: 1,
    status: "finished",
    createdAt: now,
    updatedAt: now,
    startCheckpointRef: null,
    latestCheckpointRef: null,
    ...overrides,
  };
}

function writeForkableConversation(
  id: string,
  opts: {
    title?: string;
    transcript: TranscriptEvent[];
    runs: Record<string, unknown>[];
    agentState?: Record<string, unknown>[];
    checkpoints?: Record<string, unknown>[];
  },
): void {
  const dir = conversationDir(id);
  const storeDir = join(dir, "agent-state");
  mkdirSync(storeDir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    `${JSON.stringify(
      {
        id,
        title: opts.title ?? "Planning aside",
        projectId: "platform",
        model: "composer-2.5",
        agentId: SOURCE_AGENT,
        createdAt: AT_T1,
        updatedAt: AT_T1,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, "transcript.jsonl"),
    opts.transcript.map((event) => JSON.stringify(event)).join("\n") + "\n",
  );
  writeFileSync(
    join(storeDir, JSONL_LOCAL_AGENT_STORE_FILES.runs),
    opts.runs.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  if (opts.agentState) {
    writeFileSync(
      join(storeDir, JSONL_LOCAL_AGENT_STORE_FILES.agents),
      opts.agentState.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
  if (opts.checkpoints) {
    writeFileSync(
      join(storeDir, JSONL_LOCAL_AGENT_STORE_FILES.checkpoints),
      opts.checkpoints.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
}

describe("POST /api/conversations/:id/fork", () => {
  it("forks a seeded conversation and returns writable meta with provenance", async () => {
    writeForkableConversation("conv-fork-source", {
      title: "Planning aside",
      transcript: [
        { type: "prompt", text: "go", at: AT_T1, seq: 1 },
        { type: "assistant", text: "done", at: AT_T1_END, seq: 2 },
      ],
      runs: [
        runRow({
          runId: "run-1",
          agentId: SOURCE_AGENT,
          turnNumber: 1,
          startedAt: T1_MS,
          endedAt: T1_END_MS,
          latestCheckpointRef: { schemaVersion: 1, rootBlobId: "chk-turn-1" },
        }),
      ],
      agentState: [
        {
          agentId: SOURCE_AGENT,
          cwd: "/tmp/source-workspace",
          status: "idle",
          activeRunId: null,
          createdAt: 1,
          updatedAt: 1,
          latestCheckpoint: { schemaVersion: 1, rootBlobId: "chk-turn-1" },
        },
      ],
      checkpoints: [
        {
          agentId: SOURCE_AGENT,
          blobId: "chk-turn-1",
          data: "dGVzdA==",
        },
      ],
    });
    const before = conversationFingerprint("conv-fork-source");

    const forkRes = await fetch(
      `${baseUrl}/api/conversations/conv-fork-source/fork`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seq: 2 }),
      },
    );
    expect(forkRes.status).toBe(201);
    const { id: forkId } = (await forkRes.json()) as { id: string };
    expect(forkId).toBeTruthy();
    expect(forkId).not.toBe("conv-fork-source");

    const detail = await fetch(`${baseUrl}/api/conversations/${forkId}`).then(
      (r) => r.json(),
    );
    expect(detail.meta).toMatchObject({
      forkedFrom: "conv-fork-source",
      forkedAtSeq: 2,
      projectId: "platform",
      model: "composer-2.5",
      title: "Fork @ turn 1 — Planning aside",
    });
    expect(detail.meta.readOnly).toBeUndefined();
    expect(detail.meta.issueId).toBeUndefined();
    expect(detail.meta.agentId).toBeTruthy();
    expect(detail.meta.agentId).not.toBe(SOURCE_AGENT);

    expect(conversationFingerprint("conv-fork-source")).toEqual(before);
  });

  describe("writable fork session tools", () => {
    let forkServer: Server;
    let forkBaseUrl: string;
    let forkSessions: AgentSessions;
    let fake: ReturnType<typeof createFakeAgentSdk>;

    beforeEach(async () => {
      fake = createFakeAgentSdk({
        stream: buildScriptedStreamWithAgentIdHint(),
      });
      const { createAgentSessions } = await import("../services/agent-sessions.js");
      const { createConversationsRouter } = await import("./conversations.js");
      const { errorHandler } = await import("../errors.js");
      forkSessions = createAgentSessions(fake);
      const app = express();
      app.use(express.json());
      app.use("/api/conversations", createConversationsRouter(forkSessions));
      app.use(errorHandler);

      await new Promise<void>((resolve) => {
        forkServer = app.listen(0, "127.0.0.1", () => resolve());
      });
      const addr = forkServer.address();
      if (!addr || typeof addr === "string") {
        throw new Error("expected TCP listen address");
      }
      forkBaseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
      await forkSessions.disposeAll();
      await new Promise<void>((resolve, reject) => {
        forkServer.close((err) => (err ? reject(err) : resolve()));
      });
    });

    it("resumes a fork without readOnly restrictions", async () => {
      writeForkableConversation("conv-fork-writable", {
        transcript: [
          { type: "prompt", text: "go", at: AT_T1, seq: 1 },
          { type: "assistant", text: "done", at: AT_T1_END, seq: 2 },
        ],
        runs: [
          runRow({
            runId: "run-1",
            agentId: SOURCE_AGENT,
            turnNumber: 1,
            startedAt: T1_MS,
            endedAt: T1_END_MS,
            latestCheckpointRef: { schemaVersion: 1, rootBlobId: "chk-turn-1" },
          }),
        ],
        agentState: [
          {
            agentId: SOURCE_AGENT,
            cwd: "/tmp/source-workspace",
            status: "idle",
            activeRunId: null,
            createdAt: 1,
            updatedAt: 1,
            latestCheckpoint: { schemaVersion: 1, rootBlobId: "chk-turn-1" },
          },
        ],
        checkpoints: [
          {
            agentId: SOURCE_AGENT,
            blobId: "chk-turn-1",
            data: "dGVzdA==",
          },
        ],
      });

      const forkRes = await fetch(
        `${forkBaseUrl}/api/conversations/conv-fork-writable/fork`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ seq: 2 }),
        },
      );
      expect(forkRes.status).toBe(201);
      const { id: forkId } = (await forkRes.json()) as { id: string };

      const detail = await fetch(`${forkBaseUrl}/api/conversations/${forkId}`).then(
        (r) => r.json(),
      );
      expect(detail.meta.readOnly).toBeUndefined();

      const send = await fetch(`${forkBaseUrl}/api/conversations/${forkId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "continue on the fork" }),
      });
      expect(send.status).toBe(202);

      for (let i = 0; i < 50; i += 1) {
        const run = forkSessions.getActiveRun(forkId);
        if (!run) break;
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(fake.created).toHaveLength(0);
      expect(fake.resumed).toHaveLength(1);
      expect(fake.resumed[0]?.options.disallowedTools).toBeUndefined();
      expect(fake.resumed[0]?.options.customTools).toMatchObject({
        delegate: expect.any(Object),
        delegations: expect.any(Object),
        agent_stack_start: expect.any(Object),
        agent_stack_stop: expect.any(Object),
        file_cursor_sdk_bug: expect.any(Object),
      });
    });
  });

  it("returns 400 when the position is inside an in-flight run", async () => {
    writeForkableConversation("conv-in-flight", {
      transcript: [
        { type: "prompt", text: "go", at: AT_T2, seq: 1 },
        { type: "assistant", text: "working", at: AT_T2_MID, seq: 2 },
      ],
      runs: [
        runRow({
          runId: "run-live",
          agentId: SOURCE_AGENT,
          turnNumber: 2,
          status: "running",
          startedAt: T2_MS,
          latestCheckpointRef: { schemaVersion: 1, rootBlobId: "chk-live" },
        }),
      ],
    });

    const res = await fetch(`${baseUrl}/api/conversations/conv-in-flight/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seq: 2 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/still in flight/),
      code: "validation",
    });
  });
});
