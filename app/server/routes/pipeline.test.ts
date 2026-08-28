import type { Server } from "http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "../services/agent-sessions.js";
import type {
  DelegationRecord,
  DelegationRecordWithEnd,
  TranscriptEvent,
} from "../schemas.js";
import { pluginDir } from "../config.js";

let server: Server;
let baseUrl: string;

const AT = "2026-07-09T14:00:00.000Z";
const AT_EARLY = "2026-07-09T13:00:00.000Z";
const AT_LATE = "2026-07-09T16:00:00.000Z";
const AT_END = "2026-07-09T14:00:05.000Z";

let runsRoot: string;
let runsIssuesRoot: string;
let runsConversationsDir: string;

function stubSessions(): AgentSessions {
  return {
    sendPrompt: vi.fn(),
    getActiveRun: vi.fn(),
    listActiveRuns: () => [],
    cancel: vi.fn(),
    dispose: vi.fn(),
    disposeAll: vi.fn(),
  };
}

async function startApp(): Promise<void> {
  vi.resetModules();
  const { createApp } = await import("../app.js");
  const app = createApp(stubSessions());
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function getStepSource(stepId: string) {
  return fetch(`${baseUrl}/api/pipeline/steps/${encodeURIComponent(stepId)}/source`);
}

function writeConversation(
  id: string,
  opts: {
    delegations?: DelegationRecordWithEnd[];
    transcript?: TranscriptEvent[];
    meta?: Record<string, unknown>;
  } = {},
): void {
  const dir = join(runsConversationsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    `${JSON.stringify(
      {
        id,
        title: "Test conversation",
        projectId: "platform",
        model: "composer-2.5",
        createdAt: AT,
        updatedAt: AT,
        ...opts.meta,
      },
      null,
      2,
    )}\n`,
  );
  const lines: unknown[] = [];
  for (const record of opts.delegations ?? []) {
    const { end, ...start } = record;
    lines.push(start);
    if (end !== undefined) {
      lines.push({
        kind: "end",
        delegationId: start.delegationId,
        status: end.status,
        endedAt: end.endedAt,
        ...(end.failureClass !== undefined
          ? { failureClass: end.failureClass }
          : {}),
      });
    }
  }
  writeFileSync(
    join(dir, "delegations.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n") +
      (lines.length ? "\n" : ""),
  );
  const transcript = opts.transcript ?? [];
  writeFileSync(
    join(dir, "transcript.jsonl"),
    transcript.map((e) => JSON.stringify(e)).join("\n") +
      (transcript.length ? "\n" : ""),
  );
}

function delegation(
  overrides: Partial<DelegationRecordWithEnd> &
    Pick<
      DelegationRecord,
      "delegationId" | "agentId" | "role" | "model" | "at"
    >,
): DelegationRecordWithEnd {
  const lifecycle =
    "lifecycle" in overrides ? overrides.lifecycle : "tracked";
  return {
    delegationId: overrides.delegationId,
    agentId: overrides.agentId,
    role: overrides.role,
    model: overrides.model,
    at: overrides.at,
    ...(lifecycle !== undefined ? { lifecycle } : {}),
    ...(overrides.issueId !== undefined ? { issueId: overrides.issueId } : {}),
    ...(overrides.parentCallId !== undefined
      ? { parentCallId: overrides.parentCallId }
      : {}),
    ...(overrides.parentDelegationId !== undefined
      ? { parentDelegationId: overrides.parentDelegationId }
      : {}),
    ...(overrides.end !== undefined ? { end: overrides.end } : {}),
  };
}

function toolCall(
  callId: string,
  status: "running" | "completed" | "error",
  at: string,
  seq: number,
): TranscriptEvent {
  return {
    type: "tool_call",
    callId,
    name: "delegate",
    status,
    at,
    seq,
  };
}

function setupRunsStore(): void {
  runsRoot = mkdtempSync(join(tmpdir(), "issue-tracker-pipeline-runs-route-"));
  runsIssuesRoot = join(runsRoot, "issues");
  runsConversationsDir = join(dirname(runsIssuesRoot), "conversations");
  mkdirSync(runsIssuesRoot, { recursive: true });
  mkdirSync(runsConversationsDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", runsIssuesRoot);
}

function teardownRunsStore(): void {
  vi.unstubAllEnvs();
  rmSync(runsRoot, { recursive: true, force: true });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("GET /api/pipeline/steps/:stepId/source", () => {
  it("returns a declared step's source path and markdown", async () => {
    await startApp();

    const res = await getStepSource("implement");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("agents/_issue-tracker-implementor.md");
    expect(body.markdown).toBe(
      readFileSync(
        join(pluginDir, "agents/_issue-tracker-implementor.md"),
        "utf8",
      ),
    );
  });

  it("returns 404 for an unknown step id", async () => {
    await startApp();

    const res = await getStepSource("not-a-step");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 404 for a handoff node", async () => {
    await startApp();

    const res = await getStepSource("work-handoff");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });
});

describe("pipeline runs routes", () => {
  beforeEach(() => {
    setupRunsStore();
  });

  afterEach(() => {
    teardownRunsStore();
  });

  describe("GET /api/pipeline/runs", () => {
    it("returns { runs: RecentRun[] } newest-first", async () => {
      writeConversation("conv-old", {
        meta: {
          channel: "implementing",
          issueId: "task-old",
          createdAt: AT_EARLY,
        },
        delegations: [
          delegation({
            delegationId: "del-old",
            agentId: "agent-old",
            role: "implementor",
            model: "composer-2.5",
            at: AT_EARLY,
            issueId: "task-old",
            parentCallId: "call-old",
            end: { status: "completed", endedAt: AT_END },
          }),
        ],
        transcript: [
          toolCall("call-old", "running", AT_EARLY, 1),
          toolCall("call-old", "completed", AT_END, 2),
        ],
      });

      writeConversation("conv-new", {
        meta: {
          channel: "planning",
          issueId: "task-new",
          createdAt: AT_LATE,
        },
        delegations: [
          delegation({
            delegationId: "del-new",
            agentId: "agent-new",
            role: "planner",
            model: "composer-2.5",
            at: AT_LATE,
            issueId: "task-new",
            parentCallId: "call-new",
          }),
        ],
        transcript: [toolCall("call-new", "running", AT_LATE, 1)],
      });

      await startApp();

      const res = await fetch(`${baseUrl}/api/pipeline/runs?limit=10`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        runs: [
          {
            conversationId: "conv-new",
            coordinatorLabel: "planning",
            startedAt: AT_LATE,
            condition: "in-flight",
            issueId: "task-new",
          },
          {
            conversationId: "conv-old",
            coordinatorLabel: "implementing",
            startedAt: AT_EARLY,
            condition: "completed",
            issueId: "task-old",
          },
        ],
      });
    });

    it("applies the limit query parameter", async () => {
      writeConversation("conv-a", {
        meta: { title: "Run A", createdAt: AT_EARLY },
        transcript: [{ type: "prompt", text: "hi", at: AT_EARLY, seq: 1 }],
      });
      writeConversation("conv-b", {
        meta: { title: "Run B", createdAt: AT },
        transcript: [{ type: "prompt", text: "hi", at: AT, seq: 1 }],
      });
      writeConversation("conv-c", {
        meta: { title: "Run C", createdAt: AT_LATE },
        transcript: [{ type: "prompt", text: "hi", at: AT_LATE, seq: 1 }],
      });

      await startApp();

      const res = await fetch(`${baseUrl}/api/pipeline/runs?limit=2`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.runs).toHaveLength(2);
      expect(
        body.runs.map((row: { conversationId: string }) => row.conversationId),
      ).toEqual(["conv-c", "conv-b"]);
    });
  });

  describe("GET /api/pipeline/runs/:conversationId", () => {
    it("returns the runSequence result for a known conversation", async () => {
      writeConversation("conv-done", {
        meta: { channel: "implementing", issueId: "task-done" },
        delegations: [
          delegation({
            delegationId: "del-done",
            agentId: "agent-done",
            role: "implementor",
            model: "composer-2.5",
            at: AT,
            parentCallId: "call-done",
            end: { status: "completed", endedAt: AT_END },
          }),
        ],
        transcript: [
          toolCall("call-done", "running", AT, 1),
          toolCall("call-done", "completed", AT_END, 2),
        ],
      });

      await startApp();
      const { runSequence } = await import("../services/run-sequence.js");

      const res = await fetch(`${baseUrl}/api/pipeline/runs/conv-done`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(runSequence("conv-done"));
    });

    it("returns 404 for an unknown conversation id", async () => {
      await startApp();

      const res = await fetch(
        `${baseUrl}/api/pipeline/runs/unknown-conversation`,
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: 'unknown conversation "unknown-conversation"',
        code: "not_found",
      });
    });
  });
});
