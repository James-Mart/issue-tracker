import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DelegationRecord, TranscriptEvent } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
const AT_END = "2026-07-09T16:00:00.000Z";
const ISSUE_ID = "linked-task";

let root: string;
let issuesRoot: string;
let conversationsDir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function writeConversation(
  id: string,
  opts: {
    delegations?: DelegationRecord[];
    transcript?: TranscriptEvent[];
    meta?: Record<string, unknown>;
  },
): void {
  const dir = join(conversationsDir, id);
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
  writeFileSync(
    join(dir, "delegations.jsonl"),
    (opts.delegations ?? [])
      .map((d) => JSON.stringify(d))
      .join("\n") + ((opts.delegations?.length ?? 0) ? "\n" : ""),
  );
  writeFileSync(
    join(dir, "transcript.jsonl"),
    (opts.transcript ?? [])
      .map((e) => JSON.stringify(e))
      .join("\n") + ((opts.transcript?.length ?? 0) ? "\n" : ""),
  );
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-agent-runs-route-"));
  issuesRoot = join(root, "issues");
  conversationsDir = join(root, "conversations");
  mkdirSync(issuesRoot, { recursive: true });
  mkdirSync(conversationsDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);

  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("ship-it", {
    kind: "epic",
    title: "Ship it",
    partOf: "platform",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("linked-story", {
    kind: "story",
    title: "Linked story",
    partOf: "ship-it",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue(ISSUE_ID, {
    kind: "task",
    title: "Linked task",
    partOf: "linked-story",
    createdAt: AT,
    updatedAt: AT,
  });

  const { createApp } = await import("../app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/issues/:id/agent-runs", () => {
  it("returns linked runs for an issue", async () => {
    writeConversation("conv-main", {
      delegations: [
        {
          delegationId: "del-completed",
          agentId: "agent-impl",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-completed",
        },
      ],
      transcript: [
        {
          type: "tool_call",
          callId: "call-completed",
          name: "delegate",
          status: "running",
          at: AT,
        },
        {
          type: "tool_call",
          callId: "call-completed",
          name: "delegate",
          status: "completed",
          at: AT_END,
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/issues/${ISSUE_ID}/agent-runs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({
      delegationId: "del-completed",
      agentId: "agent-impl",
      role: "implementor",
      model: "composer-2.5",
      issueId: ISSUE_ID,
      parentCallId: "call-completed",
      conversationId: "conv-main",
      startedAt: AT,
      status: "completed",
      endedAt: AT_END,
      isResume: false,
    });
  });

  it("returns an empty runs array when the issue has no linked runs", async () => {
    const res = await fetch(`${baseUrl}/api/issues/${ISSUE_ID}/agent-runs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toEqual([]);
    expect(body).not.toHaveProperty("workRoot");
  });

  it("returns workRoot for a Task under an Epic-child Story", async () => {
    writeConversation("conv-coordinator", {
      meta: {
        issueId: "ship-it",
        channel: "implementing",
      },
    });

    const res = await fetch(`${baseUrl}/api/issues/${ISSUE_ID}/agent-runs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workRoot).toEqual({
      issueId: "ship-it",
      conversationId: "conv-coordinator",
    });
  });

  it("returns 404 for an unknown issue", async () => {
    const res = await fetch(`${baseUrl}/api/issues/missing-task/agent-runs`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });
});

describe("GET /api/issues/:id/agent-runs/:delegationId/events", () => {
  it("returns subagent_update events for a linked run", async () => {
    writeConversation("conv-main", {
      delegations: [
        {
          delegationId: "del-a",
          agentId: "agent-a",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-a",
        },
        {
          delegationId: "del-b",
          agentId: "agent-b",
          role: "validator",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-b",
        },
      ],
      transcript: [
        {
          type: "tool_call",
          callId: "call-a",
          name: "delegate",
          status: "running",
          at: AT,
        },
        {
          type: "subagent_update",
          parentCallId: "call-a",
          step: { kind: "text", text: "run a step 1" },
          at: AT,
          seq: 2,
        },
        {
          type: "subagent_update",
          parentCallId: "call-b",
          step: { kind: "text", text: "run b step" },
          at: AT,
          seq: 3,
        },
        {
          type: "subagent_update",
          parentCallId: "call-a",
          step: { kind: "text", text: "run a step 2" },
          at: AT,
          seq: 4,
        },
        {
          type: "tool_call",
          callId: "call-a",
          name: "delegate",
          status: "completed",
          at: AT_END,
        },
        {
          type: "tool_call",
          callId: "call-b",
          name: "delegate",
          status: "completed",
          at: AT_END,
        },
      ],
    });

    const res = await fetch(
      `${baseUrl}/api/issues/${ISSUE_ID}/agent-runs/del-a/events`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(2);
    expect(body.events.map((e: { step: { text: string } }) => e.step.text)).toEqual([
      "run a step 1",
      "run a step 2",
    ]);
  });

  it("returns 404 for an unknown delegationId", async () => {
    const res = await fetch(
      `${baseUrl}/api/issues/${ISSUE_ID}/agent-runs/del-missing/events`,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 404 for an unknown issue", async () => {
    const res = await fetch(
      `${baseUrl}/api/issues/missing-task/agent-runs/del-a/events`,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });
});
