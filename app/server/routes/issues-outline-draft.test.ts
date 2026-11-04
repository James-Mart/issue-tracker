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

function writeOutline(description: string): void {
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
  writeFileSync(join(issuesDir, "spec", "description.md"), description);
  mkdirSync(join(issuesDir, "spec", "versions"), { recursive: true });
  writeFileSync(join(issuesDir, "spec", "versions", "3.md"), description);
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-outline-draft-"));
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
  writeOutline("saved\n");
  writeIssue("story-open", {
    kind: "story",
    title: "Open story",
    partOf: "p",
    order: 2,
    merged: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("task-a", {
    kind: "task",
    title: "Already covered",
    partOf: "story-open",
    order: 0,
    status: "todo",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("idea-append", {
    kind: "idea",
    title: "Append idea",
    partOf: "p",
    order: 3,
    archived: false,
    appendTo: "story-open",
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

describe("outline draft HTTP API", () => {
  it("publishes the draft as the next version and starts reconciliation", async () => {
    expect(
      (await request("PUT", "/api/issues/spec/outline-draft", { body: "next\n" }))
        .status,
    ).toBe(200);

    const updated = await request("POST", "/api/issues/spec/outline-draft/update", {
      targetStory: "story-open",
      coveredBy: ["task-a"],
      sourceIdea: "idea-append",
    });
    expect(updated.status).toBe(201);
    const body = (await updated.json()) as {
      id: string;
      title: string;
      model: string;
      version: number;
    };
    expect(body).toMatchObject({
      title: "Reconcile Feature outline",
      model: "cursor-grok-4.7",
      version: 4,
    });

    const detail = (await (await request("GET", "/api/issues/spec")).json()) as {
      bodyVersion: number;
      description: string;
      pendingDraft?: string;
    };
    expect(detail.bodyVersion).toBe(4);
    expect(detail.description).toBe("next\n");
    expect(detail.pendingDraft).toBeUndefined();
    expect(readFileSync(join(issuesDir, "spec", "versions", "3.md"), "utf8")).toBe(
      "saved\n",
    );
    expect(readFileSync(join(issuesDir, "spec", "versions", "4.md"), "utf8")).toBe(
      "next\n",
    );

    const { listConversations } = await import("../services/conversations.js");
    const { transcriptPathOf } = await import(
      "../services/conversation-transcript-seq.js"
    );
    const { outlineReconcileSessionMessage } = await import(
      "../../src/features/issues/lib/outline-planning-launch.js"
    );
    const [meta] = listConversations();
    expect(meta).toMatchObject({
      id: body.id,
      issueId: "spec",
      channel: "planning",
      title: "Reconcile Feature outline",
    });
    const line = readFileSync(transcriptPathOf(meta!.id), "utf8").trim();
    const { text } = JSON.parse(line) as { text: string };
    expect(text).toBe(
      outlineReconcileSessionMessage({
        outlineId: "spec",
        version: 4,
        targetStory: "story-open",
        coveredBy: ["task-a"],
        sourceIdea: "idea-append",
      }),
    );
  });

  it("refuses a source idea without a target story before saving a version", async () => {
    await request("PUT", "/api/issues/spec/outline-draft", { body: "next\n" });

    const refused = await request(
      "POST",
      "/api/issues/spec/outline-draft/update",
      { sourceIdea: "idea-append" },
    );
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain(
      "source idea requires a target story",
    );

    const detail = (await (await request("GET", "/api/issues/spec")).json()) as {
      bodyVersion: number;
      pendingDraft?: string;
    };
    expect(detail.bodyVersion).toBe(3);
    expect(detail.pendingDraft).toBe("next\n");
  });
});
