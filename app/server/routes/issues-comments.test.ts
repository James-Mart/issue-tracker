import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const COMMIT_SHA = "deadbeef00000000000000000000000000000000";
let dir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-comments-route-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("idea-1", {
    kind: "idea",
    title: "Capture",
    partOf: "p",
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
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(dir, { recursive: true, force: true });
});

async function postComment(
  issueId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/issues/${issueId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function getComments(
  issueId: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/issues/${issueId}/comments`);
  return { status: res.status, json: await res.json() };
}

describe("comments HTTP API", () => {
  it("accepts comments on an Idea and creates comments.jsonl", async () => {
    const { status, json } = await postComment("idea-1", {
      role: "stakeholder",
      body: "audit note",
    });
    expect(status).toBe(201);
    const body = json as { role: string; body: string; id: string };
    expect(body.role).toBe("stakeholder");
    expect(body.body).toBe("audit note");
    expect(body.id.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, "idea-1", "comments.jsonl"))).toBe(true);
  });

  it("accepts an anchored comment and returns its id", async () => {
    const anchor = {
      path: "app/server/services/issues.ts",
      side: "new" as const,
      line: 42,
      startLine: 40,
      commitSha: COMMIT_SHA,
    };
    const { status, json } = await postComment("idea-1", {
      role: "agent",
      body: "on this line",
      anchor,
    });
    expect(status).toBe(201);
    const body = json as { id: string; anchor: typeof anchor };
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.anchor).toEqual(anchor);
  });

  it("accepts a reply and returns its id and replyTo", async () => {
    const { json: rootJson } = await postComment("idea-1", {
      role: "agent",
      body: "root",
    });
    const rootId = (rootJson as { id: string }).id;

    const { status, json } = await postComment("idea-1", {
      role: "human",
      body: "reply",
      replyTo: rootId,
    });
    expect(status).toBe(201);
    const body = json as { id: string; replyTo: string };
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.replyTo).toBe(rootId);
    expect(body.id).not.toBe(rootId);
  });

  it("GET round-trips id, replyTo, and anchor on the messages envelope", async () => {
    const anchor = {
      path: "app/server/routes/issues.ts",
      side: "new" as const,
      line: 10,
      commitSha: COMMIT_SHA,
    };
    const { json: anchoredJson } = await postComment("idea-1", {
      role: "agent",
      body: "anchored",
      anchor,
    });
    const anchoredId = (anchoredJson as { id: string }).id;

    const { json: rootJson } = await postComment("idea-1", {
      role: "agent",
      body: "root for reply",
    });
    const rootId = (rootJson as { id: string }).id;

    const { json: replyJson } = await postComment("idea-1", {
      role: "human",
      body: "thread reply",
      replyTo: rootId,
    });
    const replyId = (replyJson as { id: string }).id;

    const { status, json } = await getComments("idea-1");
    expect(status).toBe(200);
    const body = json as {
      messages: Array<{
        id: string;
        body: string;
        anchor?: typeof anchor;
        replyTo?: string;
      }>;
      problems: unknown[];
    };
    expect(body.problems).toEqual([]);
    expect(body.messages).toHaveLength(3);

    const anchored = body.messages.find((m) => m.id === anchoredId);
    expect(anchored?.body).toBe("anchored");
    expect(anchored?.anchor).toEqual(anchor);
    expect(anchored?.replyTo).toBeUndefined();

    const root = body.messages.find((m) => m.id === rootId);
    expect(root?.body).toBe("root for reply");
    expect(root?.anchor).toBeUndefined();
    expect(root?.replyTo).toBeUndefined();

    const reply = body.messages.find((m) => m.id === replyId);
    expect(reply?.body).toBe("thread reply");
    expect(reply?.replyTo).toBe(rootId);
    expect(reply?.anchor).toBeUndefined();
  });

  it("returns 400 with the service reason when replyTo is unknown", async () => {
    const { status, json } = await postComment("idea-1", {
      role: "agent",
      body: "orphan reply",
      replyTo: "missing-id",
    });
    expect(status).toBe(400);
    expect(json).toMatchObject({
      error: expect.stringMatching(/unknown comment/i),
      code: "validation",
    });
  });
});
