import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
} from "../services/agent-sdk.fake.js";
import type { ConversationChannel } from "../schemas.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import { channelSessionPairKey } from "../services/channel-session-list.js";

const AT = "2026-08-10T12:00:00.000Z";

let root: string;
let issuesRoot: string;
let workspaceDir: string;
let server: Server;
let baseUrl: string;

async function listSessions(issueId: string, channel: ConversationChannel) {
  const res = await fetch(`${baseUrl}/api/channel-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairs: [{ issueId, channel }] }),
  });
  if (!res.ok) {
    throw new Error(
      `list channel sessions failed: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    sessions: Record<string, ListedSession[]>;
  };
  const sessions = body.sessions[channelSessionPairKey(issueId, channel)];
  if (!sessions) {
    throw new Error(
      `channel-sessions response missing ${channelSessionPairKey(issueId, channel)}`,
    );
  }
  return sessions;
}

type ListedSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  activeRun: boolean;
  awaitingHuman: boolean;
};

let sessions: AgentSessions | undefined;
let releaseHold: (() => void) | undefined;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

async function startApp(opts?: {
  hold?: boolean;
}): Promise<void> {
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);

  if (opts?.hold) {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    releaseHold = release;
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
      hold,
    });
    const { createAgentSessions } = await import("../services/agent-sessions.js");
    sessions = createAgentSessions(fake);
  } else {
    sessions = undefined;
    releaseHold = undefined;
  }

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
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-channel-sessions-"));
  issuesRoot = join(root, "issues");
  mkdirSync(issuesRoot, { recursive: true });
  workspaceDir = mkdtempSync(join(tmpdir(), "issue-channel-ws-"));
  mkdirSync(join(workspaceDir, ".git"));

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
  writeIssue("child-story", {
    kind: "story",
    title: "Child story",
    partOf: "ship-it",
    status: "todo",
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("a-task", {
    kind: "task",
    title: "A task",
    partOf: "child-story",
    status: "todo",
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(async () => {
  if (releaseHold) releaseHold();
  if (sessions) await sessions.disposeAll();
  const { agentSessions } = await import("../services/agent-sessions.js");
  await agentSessions.disposeAll();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(root, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("channel sessions HTTP API", () => {
  it("refuses creation when the issue does not offer the channel", async () => {
    await startApp();

    const prior = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "Keep me" }),
      },
    ).then((r) => r.json());

    const res = await fetch(
      `${baseUrl}/api/issues/a-task/channels/planning/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5" }),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'issue "a-task" does not offer a channel',
      code: "validation",
    });

    const wrongChannel = await fetch(
      `${baseUrl}/api/issues/capture/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5" }),
      },
    );
    expect(wrongChannel.status).toBe(400);
    expect(await wrongChannel.json()).toEqual({
      error: 'channel "implementing" is not offered by issue "capture"',
      code: "validation",
    });

    // Refused POSTs must not archive or otherwise mutate existing sessions.
    const stillActive = await listSessions("capture", "planning");
    expect(stillActive).toEqual([
      expect.objectContaining({ id: prior.id, archived: false }),
    ]);

    const epicChild = await fetch(
      `${baseUrl}/api/issues/child-story/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5" }),
      },
    );
    expect(epicChild.status).toBe(400);
  });

  it("archives a predecessor so the channel keeps a single active session", async () => {
    await startApp();

    const first = await fetch(
      `${baseUrl}/api/issues/ship-it/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "Old" }),
      },
    ).then((r) => r.json());

    const second = await fetch(
      `${baseUrl}/api/issues/ship-it/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "New" }),
      },
    ).then((r) => r.json());

    const listed = await listSessions("ship-it", "implementing");
    const byId = new Map<string, ListedSession>(
      listed.map((s: ListedSession) => [s.id, s]),
    );
    expect(byId.get(first.id)?.archived).toBe(true);
    expect(byId.get(second.id)?.archived).toBe(false);
    expect(
      listed.filter((s: { archived: boolean }) => !s.archived),
    ).toHaveLength(1);
  });

  it("refuses a second implementing session on the same work root while a run is active", async () => {
    await startApp({ hold: true });

    const first = await fetch(
      `${baseUrl}/api/issues/ship-it/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "composer-2.5",
          title: "Holder",
          message: "start implementing",
        }),
      },
    );
    expect(first.status).toBe(201);
    const { id: holderId } = await first.json();
    expect(sessions!.getActiveRun(holderId)).toBeTruthy();

    const refused = await fetch(
      `${baseUrl}/api/issues/ship-it/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "Blocked" }),
      },
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: expect.stringContaining("ship-it"),
      code: "conflict",
      holderIssueId: "ship-it",
      holderIssueTitle: "Ship it",
    });

    const listed = await listSessions("ship-it", "implementing");
    expect(listed).toEqual([
      expect.objectContaining({ id: holderId, archived: false, activeRun: true }),
    ]);
  });

  it("allows a new implementing session once the holder run ends", async () => {
    writeIssue("other-epic", {
      kind: "epic",
      title: "Other epic",
      partOf: "platform",
      status: "open",
      order: 1,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    await startApp({ hold: true });

    const first = await fetch(
      `${baseUrl}/api/issues/ship-it/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "composer-2.5",
          title: "Holder",
          message: "start implementing",
        }),
      },
    );
    expect(first.status).toBe(201);
    const { id: holderId } = await first.json();
    expect(sessions!.getActiveRun(holderId)).toBeTruthy();

    releaseHold!();
    await sessions!.getActiveRun(holderId)!.wait();
    expect(sessions!.getActiveRun(holderId)).toBeUndefined();

    const second = await fetch(
      `${baseUrl}/api/issues/other-epic/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "Next" }),
      },
    );
    expect(second.status).toBe(201);
    const { id: nextId } = await second.json();

    const listed = await listSessions("other-epic", "implementing");
    expect(listed).toEqual([
      expect.objectContaining({ id: nextId, archived: false, activeRun: false }),
    ]);
  });
});
