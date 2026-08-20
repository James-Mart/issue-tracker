import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
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
let sessions: AgentSessions | undefined;
let releaseHold: (() => void) | undefined;

function writeIssue(
  id: string,
  body: Record<string, unknown>,
  description?: string,
): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
  if (description !== undefined) {
    writeFileSync(join(issuesRoot, id, "description.md"), description);
  }
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
  it("creates a session on an eligible issue and lists it idle without a message", async () => {
    await startApp();

    const created = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "Plan it" }),
      },
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toEqual({ id: expect.any(String) });

    const listed = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
    ).then((r) => r.json());
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: body.id,
      title: "Plan it",
      model: "composer-2.5",
      archived: false,
      activeRun: false,
    });
    expect(listed[0].createdAt).toEqual(expect.any(String));
    expect(listed[0].updatedAt).toEqual(expect.any(String));
  });

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
    const stillActive = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
    ).then((r) => r.json());
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

  it("lists sessions most recently updated first", async () => {
    await startApp();

    const first = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "First" }),
      },
    ).then((r) => r.json());

    const second = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "Second" }),
      },
    ).then((r) => r.json());

    // Bump the older (archived) session so it sorts ahead of the active one.
    const bumped = await fetch(`${baseUrl}/api/conversations/${first.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "First (touched)" }),
    });
    expect(bumped.status).toBe(200);

    const listed = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
    ).then((r) => r.json());
    expect(listed.map((s: { id: string }) => s.id)).toEqual([
      first.id,
      second.id,
    ]);
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

    const listed = await fetch(
      `${baseUrl}/api/issues/ship-it/channels/implementing/sessions`,
    ).then((r) => r.json());
    const byId = new Map(
      listed.map((s: { id: string; archived: boolean; title: string }) => [
        s.id,
        s,
      ]),
    );
    expect(byId.get(first.id)?.archived).toBe(true);
    expect(byId.get(second.id)?.archived).toBe(false);
    expect(
      listed.filter((s: { archived: boolean }) => !s.archived),
    ).toHaveLength(1);
  });

  it("starts a run when created with a message and reports activeRun", async () => {
    await startApp({ hold: true });

    const created = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "composer-2.5",
          title: "Live",
          message: "start planning",
        }),
      },
    );
    expect(created.status).toBe(201);
    const { id } = await created.json();

    expect(sessions!.getActiveRun(id)).toBeTruthy();

    const listed = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
    ).then((r) => r.json());
    expect(listed).toEqual([
      expect.objectContaining({
        id,
        activeRun: true,
        archived: false,
      }),
    ]);
  });

  it("refuses a second implementing session while another Project run is active", async () => {
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

    const refused = await fetch(
      `${baseUrl}/api/issues/other-epic/channels/implementing/sessions`,
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

    const otherListed = await fetch(
      `${baseUrl}/api/issues/other-epic/channels/implementing/sessions`,
    ).then((r) => r.json());
    expect(otherListed).toEqual([]);
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

    const listed = await fetch(
      `${baseUrl}/api/issues/other-epic/channels/implementing/sessions`,
    ).then((r) => r.json());
    expect(listed).toEqual([
      expect.objectContaining({ id: nextId, archived: false, activeRun: false }),
    ]);
  });

  it("allows a new implementing session once the holder run is cancelled", async () => {
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

    const cancelled = await fetch(
      `${baseUrl}/api/conversations/${holderId}/cancel`,
      { method: "POST" },
    );
    expect(cancelled.status).toBe(200);
    expect(sessions!.getActiveRun(holderId)).toBeUndefined();

    const listed = await fetch(
      `${baseUrl}/api/issues/ship-it/channels/implementing/sessions`,
    ).then((r) => r.json());
    expect(listed).toEqual([
      expect.objectContaining({ id: holderId, archived: false, activeRun: false }),
    ]);

    const second = await fetch(
      `${baseUrl}/api/issues/other-epic/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "Next" }),
      },
    );
    expect(second.status).toBe(201);
  });

  it("allows a new implementing session once the holder is archived", async () => {
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

    const archived = await fetch(`${baseUrl}/api/conversations/${holderId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    expect(archived.status).toBe(200);

    const second = await fetch(
      `${baseUrl}/api/issues/other-epic/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "Next" }),
      },
    );
    expect(second.status).toBe(201);
  });
});

describe("planning work root HTTP API", () => {
  it("returns null when the Idea has no landed root yet", async () => {
    await startApp();

    const res = await fetch(`${baseUrl}/api/issues/capture/planning-work-root`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workRoot: null });
  });

  it("returns the Epic whose sourceIdea points at the Idea", async () => {
    writeIssue("ship-it", {
      kind: "epic",
      title: "Ship it",
      partOf: "platform",
      status: "open",
      order: 0,
      archived: false,
      sourceIdea: "capture",
      createdAt: AT,
      updatedAt: AT,
    });
    await startApp();

    const res = await fetch(`${baseUrl}/api/issues/capture/planning-work-root`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workRoot: { id: "ship-it", title: "Ship it", kind: "epic" },
    });
  });

  it("refuses non-Idea issues", async () => {
    await startApp();

    const res = await fetch(`${baseUrl}/api/issues/ship-it/planning-work-root`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "planning-work-root is only defined for Ideas",
      code: "validation",
    });
  });
});
