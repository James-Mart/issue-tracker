import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-08-10T12:00:00.000Z";
const HIDDEN_LINE_COUNT = 4_000;

let root: string;
let issuesRoot: string;
let workspaceDir: string;
let server: Server;
let baseUrl: string;

function conversationsDir(): string {
  return join(dirname(issuesRoot), "conversations");
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(
    join(issuesRoot, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

function writeLargeTranscript(conversationId: string): void {
  const path = join(conversationsDir(), conversationId, "transcript.jsonl");
  const line = `${JSON.stringify({
    type: "assistant",
    text: `Hidden history ${"x".repeat(120)}`,
    at: AT,
  })}\n`;
  const batch = line.repeat(200);
  for (let i = 0; i < HIDDEN_LINE_COUNT / 200; i++) {
    appendFileSync(path, batch);
  }
}

async function createChannelSession(
  issueId: string,
  channel: "planning" | "implementing",
  title: string,
): Promise<string> {
  const created = await fetch(
    `${baseUrl}/api/issues/${issueId}/channels/${channel}/sessions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "composer-2.5", title }),
    },
  );
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  return id;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-visible-load-"));
  issuesRoot = join(root, "issues");
  mkdirSync(issuesRoot, { recursive: true });
  workspaceDir = mkdtempSync(join(tmpdir(), "issue-visible-load-ws-"));
  mkdirSync(join(workspaceDir, ".git"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);

  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    workspace: workspaceDir,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("capture", {
    kind: "idea",
    title: "Capture",
    partOf: "platform",
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("ship-it", {
    kind: "epic",
    title: "Ship it",
    partOf: "platform",
    status: "open",
    order: 0,
    archived: false,
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
  const { agentSessions } = await import("../services/agent-sessions.js");
  await agentSessions.disposeAll();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(root, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("visible transcript load against large hidden channel sessions", () => {
  it("completes GET /transcript as { events, latestSeq } while other channels hold large histories", async () => {
    const hiddenIds = [
      await createChannelSession("ship-it", "implementing", "Hidden one"),
      await createChannelSession("ship-it", "implementing", "Hidden two"),
      await createChannelSession("ship-it", "implementing", "Hidden three"),
    ];
    for (const id of hiddenIds) writeLargeTranscript(id);
    for (const id of hiddenIds) {
      expect(
        statSync(join(conversationsDir(), id, "transcript.jsonl")).size,
      ).toBeGreaterThan(400_000);
    }

    const visibleId = await createChannelSession(
      "capture",
      "planning",
      "Visible thread",
    );
    const { appendEvent } = await import("../services/conversations.js");
    const first = await appendEvent(visibleId, {
      type: "prompt",
      text: "visible prompt",
    });
    const second = await appendEvent(visibleId, {
      type: "assistant",
      text: "visible reply",
    });

    const [hiddenList, pageRes] = await Promise.all([
      fetch(`${baseUrl}/api/issues/ship-it/channels/implementing/sessions`),
      fetch(`${baseUrl}/api/conversations/${visibleId}/transcript`),
    ]);
    expect(hiddenList.ok).toBe(true);
    expect(pageRes.ok).toBe(true);

    const page = (await pageRes.json()) as Record<string, unknown>;
    expect(Object.keys(page).sort()).toEqual(["events", "latestSeq"]);
    expect(page).toEqual({
      events: [
        expect.objectContaining({
          type: "prompt",
          text: "visible prompt",
          seq: first.seq,
        }),
        expect.objectContaining({
          type: "assistant",
          text: "visible reply",
          seq: second.seq,
        }),
      ],
      latestSeq: second.seq,
    });
    expect(page).not.toHaveProperty("limit");
    expect(page).not.toHaveProperty("beforeSeq");
    expect(page).not.toHaveProperty("hasMore");
  });
});
