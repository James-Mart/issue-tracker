import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
} from "../services/agent-sdk.fake.js";
import type { AgentSessions } from "../services/agent-sessions.js";

const AT = "2026-08-10T12:00:00.000Z";

let root: string;
let issuesRoot: string;
let workspaceDir: string;
let server: Server;
let baseUrl: string;
let sessions: AgentSessions;
let releaseHold: () => void;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function startedId(res: Response): Promise<string> {
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-outline-channels-"));
  issuesRoot = join(root, "issues");
  mkdirSync(issuesRoot, { recursive: true });
  workspaceDir = mkdtempSync(join(tmpdir(), "issue-outline-channels-ws-"));
  mkdirSync(join(workspaceDir, ".git"));
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: workspaceDir,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("spec", {
    kind: "outline",
    title: "Feature outline",
    partOf: "p",
    bodyVersion: 1,
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });

  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  const { createAgentSessions } = await import("../services/agent-sessions.js");
  sessions = createAgentSessions(
    createFakeAgentSdk({ stream: buildScriptedStreamWithAgentIdHint(), hold }),
  );
  const { createApp } = await import("../app.js");
  const app = createApp(sessions);
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
  releaseHold();
  await sessions.disposeAll();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(root, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("outline planning and decomposition channels", () => {
  it("refuses a prompt on an idle planning session while a decomposer runs", async () => {
    const plannerId = await startedId(
      await post("/api/issues/spec/channels/planning/sessions", {
        model: "composer-2.5",
      }),
    );
    const decomposerId = await startedId(
      await post("/api/issues/spec/outline/decompose", { executionGate: "off" }),
    );

    const refused = await post(`/api/conversations/${plannerId}/messages`, {
      prompt: "keep planning",
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: 'issue "spec" already has an active decomposition session',
      code: "conflict",
      holderIssueId: "spec",
      holderIssueTitle: "Feature outline",
    });
    expect(sessions.getActiveRun(plannerId)).toBeUndefined();
    expect(sessions.getActiveRun(decomposerId)).toBeTruthy();
  });
});
