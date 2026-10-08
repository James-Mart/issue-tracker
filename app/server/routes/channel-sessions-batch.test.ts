import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-08-10T12:00:00.000Z";

let root: string;
let issuesRoot: string;
let server: Server;
let baseUrl: string;

function conversationsDir(): string {
  return join(dirname(issuesRoot), "conversations");
}

function writeMeta(
  id: string,
  fields: Record<string, unknown>,
): void {
  const dir = join(conversationsDir(), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    `${JSON.stringify({
      id,
      title: id,
      projectId: "platform",
      model: "composer-2.5",
      createdAt: AT,
      updatedAt: AT,
      archived: false,
      awaitingHuman: false,
      ...fields,
    })}\n`,
  );
}

async function startApp(): Promise<void> {
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);
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
}

async function postPairs(pairs: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/channel-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairs }),
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-channel-sessions-batch-"));
  issuesRoot = join(root, "issues");
  mkdirSync(issuesRoot, { recursive: true });
});

afterEach(async () => {
  const { agentSessions } = await import("../services/agent-sessions.js");
  await agentSessions.disposeAll();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(root, { recursive: true, force: true });
});

describe("POST /api/channel-sessions", () => {
  it("returns each requested pair from the metadata index, newest first", async () => {
    writeMeta("newer", {
      title: "Newer",
      issueId: "ship-it",
      channel: "implementing",
      updatedAt: "2026-08-03T00:00:00.000Z",
    });
    writeMeta("older", {
      title: "Older",
      issueId: "ship-it",
      channel: "implementing",
      updatedAt: "2026-08-01T00:00:00.000Z",
      archived: true,
    });
    writeMeta("plan", {
      title: "Plan",
      issueId: "capture",
      channel: "planning",
    });
    writeMeta("other-channel", {
      title: "Planning on ship-it",
      issueId: "ship-it",
      channel: "planning",
    });
    writeMeta("free-form", { title: "Free-form chat" });
    await startApp();

    const res = await postPairs([
      { issueId: "ship-it", channel: "implementing" },
      { issueId: "capture", channel: "planning" },
      { issueId: "ship-it", channel: "export" },
      { issueId: "ship-it", channel: "implementing" },
    ]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.sessions)).toEqual([
      "ship-it:implementing",
      "capture:planning",
      "ship-it:export",
    ]);
    expect(body.sessions["ship-it:implementing"].map((s: { id: string }) => s.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(body.sessions["ship-it:implementing"][0]).toMatchObject({
      title: "Newer",
      archived: false,
      activeRun: false,
      awaitingHuman: false,
    });
    expect(body.sessions["capture:planning"]).toEqual([
      expect.objectContaining({ id: "plan", title: "Plan" }),
    ]);
    expect(body.sessions["ship-it:export"]).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("other-channel");
    expect(JSON.stringify(body)).not.toContain("free-form");
  });

  it("rejects a body that is not a list of issue-channel pairs", async () => {
    await startApp();

    const missing = await fetch(`${baseUrl}/api/channel-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    const missingBody = (await missing.json()) as { error: string; code: string };
    expect(missingBody.code).toBe("validation");
    expect(missingBody.error).toContain("pairs");

    const badChannel = await postPairs([
      { issueId: "ship-it", channel: "nope" },
    ]);
    expect(badChannel.status).toBe(400);
    expect(await badChannel.json()).toMatchObject({ code: "validation" });

    const emptyId = await postPairs([{ issueId: "", channel: "planning" }]);
    expect(emptyId.status).toBe(400);
    expect(await emptyId.json()).toMatchObject({ code: "validation" });
  });

  it("accepts an empty pair list", async () => {
    await startApp();
    const res = await postPairs([]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: {} });
  });

  it("no longer lists sessions from the per-issue GET", async () => {
    writeMeta("plan", {
      title: "Plan",
      issueId: "capture",
      channel: "planning",
    });
    await startApp();

    const gone = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
    );
    expect(gone.status).toBe(404);

    const listed = await postPairs([
      { issueId: "capture", channel: "planning" },
    ]);
    expect(listed.status).toBe(200);
    expect((await listed.json()).sessions["capture:planning"]).toEqual([
      expect.objectContaining({ id: "plan" }),
    ]);
  });
});
