import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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
  it("resolves and unresolves a Story thread, posting an optional reply in the same write", async () => {
    writeIssue("story-1", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const { json: rootJson } = await postComment("story-1", {
      role: "story-review",
      body: "please fix",
    });
    const threadId = (rootJson as { id: string }).id;

    const resolved = await fetch(
      `${baseUrl}/api/issues/story-1/threads/${threadId}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "resolved", body: "fixed it" }),
      },
    );
    expect(resolved.status).toBe(201);
    const resolvedJson = (await resolved.json()) as {
      thread: { rootId: string; kind: string; state: string };
      event: { event: string; by: { role: string } };
      reply: { body: string; replyTo: string };
    };
    expect(resolvedJson.thread).toEqual({
      rootId: threadId,
      kind: "review",
      state: "resolved",
      readyToTask: false,
    });
    expect(resolvedJson.event.event).toBe("resolved");
    expect(resolvedJson.event.by).toEqual({ role: "human" });
    expect(resolvedJson.reply.body).toBe("fixed it");
    expect(resolvedJson.reply.replyTo).toBe(threadId);

    const { json: afterResolve } = await getComments("story-1");
    const resolvedView = afterResolve as {
      messages: unknown[];
      threads: Array<{ state: string }>;
    };
    expect(resolvedView.messages).toHaveLength(2);
    expect(resolvedView.threads).toEqual([
      { rootId: threadId, kind: "review", state: "resolved", readyToTask: false },
    ]);

    const unresolved = await fetch(
      `${baseUrl}/api/issues/story-1/threads/${threadId}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "unresolved" }),
      },
    );
    expect(unresolved.status).toBe(201);
    const { json: afterOpen } = await getComments("story-1");
    const openView = afterOpen as {
      messages: unknown[];
      threads: Array<{ state: string }>;
    };
    expect(openView.messages).toHaveLength(2);
    expect(openView.threads[0]?.state).toBe("open");
  });

  it("PATCH edits an anchored review comment and refuses a story note", async () => {
    writeIssue("story-edit", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const { json: created } = await postComment("story-edit", {
      role: "human",
      body: "pending",
      anchor: {
        path: "src/review.ts",
        side: "new",
        line: 2,
        commitSha: COMMIT_SHA,
      },
    });
    const commentId = (created as { id: string }).id;

    const extra = await fetch(
      `${baseUrl}/api/issues/story-edit/comments/${commentId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "next", role: "agent" }),
      },
    );
    expect(extra.status).toBe(400);

    const patched = await fetch(
      `${baseUrl}/api/issues/story-edit/comments/${commentId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "next" }),
      },
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      id: commentId,
      body: "next",
      editable: true,
      role: "human",
    });

    const { json } = await getComments("story-edit");
    const view = json as {
      messages: Array<{ id: string; body: string; editable: boolean }>;
    };
    expect(view.messages[0]).toMatchObject({
      id: commentId,
      body: "next",
      editable: true,
    });

    const lines = readFileSync(join(dir, "story-edit", "comments.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type?: string; body: string; role?: string });
    expect(lines[0]?.body).toBe("pending");
    expect(lines[1]).toMatchObject({
      type: "comment-edit",
      body: "next",
      role: "human",
    });

    const { json: note } = await postComment("story-edit", {
      role: "human",
      body: "a note",
    });
    const noteId = (note as { id: string }).id;
    const refused = await fetch(
      `${baseUrl}/api/issues/story-edit/comments/${noteId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "nope" }),
      },
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "conflict",
      error: expect.stringContaining("Story note"),
    });

    const missing = await fetch(
      `${baseUrl}/api/issues/story-edit/comments/missing`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "nope" }),
      },
    );
    expect(missing.status).toBe(404);
  });
});
