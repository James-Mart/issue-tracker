import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "../services/agent-sessions.js";
import { fakeLauncherSessions } from "../services/queue-launcher.test-helpers.js";

const AT = "2026-07-09T14:00:00.000Z";

let rootDir: string;
let issuesDir: string;
let server: Server;
let baseUrl: string;
let sessions: AgentSessions;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

async function postDecompose(
  id: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/api/issues/${id}/outline/decompose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectDecomposeTranscript(
  metaId: string,
  expected: Parameters<
    typeof import("../../src/features/issues/lib/outline-planning-launch.js").outlineDecomposerSessionMessage
  >[0],
): Promise<void> {
  const { transcriptPathOf } = await import(
    "../services/conversation-transcript-seq.js"
  );
  const { outlineDecomposerSessionMessage } = await import(
    "../../src/features/issues/lib/outline-planning-launch.js"
  );
  const line = readFileSync(transcriptPathOf(metaId), "utf8").trim();
  expect(JSON.parse(line).text).toBe(outlineDecomposerSessionMessage(expected));
}

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-outline-decompose-"));
  issuesDir = join(rootDir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: "/tmp/repo",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("spec", {
    kind: "outline",
    title: "Feature outline",
    partOf: "p",
    bodyVersion: 3,
    order: 1,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });

  sessions = fakeLauncherSessions().sessions;
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
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(rootDir, { recursive: true, force: true });
});

describe("POST /api/issues/:id/outline/decompose", () => {
  it("reads the stored execution gate and merge policy and refuses them in the body", async () => {
    writeIssue("spec", {
      kind: "outline",
      title: "Feature outline",
      partOf: "p",
      bodyVersion: 3,
      executionGate: true,
      codeApprovalRequired: false,
      mergePolicy: "pull-request",
      order: 1,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });

    const refused = await postDecompose("spec", { executionGate: "off" });
    expect(refused.status).toBe(400);
    const refusedPolicy = await postDecompose("spec", {
      mergePolicy: "pull-request",
    });
    expect(refusedPolicy.status).toBe(400);

    const res = await postDecompose("spec", {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      title: string;
      model: string;
    };
    expect(body).toMatchObject({
      title: "Decompose Feature outline",
      model: "cursor-grok-4.7",
    });

    const { listConversations } = await import("../services/conversations.js");
    const [meta] = listConversations();
    expect(meta).toMatchObject({
      id: body.id,
      issueId: "spec",
      channel: "decomposition",
      outlineRole: "decomposer",
      model: "cursor-grok-4.7",
      title: "Decompose Feature outline",
    });
    await expectDecomposeTranscript(meta!.id, {
      outlineId: "spec",
      version: 3,
      executionGate: "on",
      mergePolicy: "pull-request",
    });
  });

  it("resolves auto from codeApprovalRequired", async () => {
    writeIssue("spec", {
      kind: "outline",
      title: "Feature outline",
      partOf: "p",
      bodyVersion: 3,
      executionGate: "auto",
      codeApprovalRequired: true,
      order: 1,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });

    const res = await postDecompose("spec", {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const { listConversations } = await import("../services/conversations.js");
    const [meta] = listConversations();
    expect(meta?.id).toBe(body.id);
    await expectDecomposeTranscript(meta!.id, {
      outlineId: "spec",
      version: 3,
      executionGate: "on",
    });
  });
});
