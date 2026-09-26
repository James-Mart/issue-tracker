import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const REQUEST = "- Input: the public webhook URL";

let dir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function readStory(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "s", "issue.json"), "utf8"));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-human-done-route-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s", {
    kind: "story",
    title: "Story",
    partOf: "p",
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
  if (!addr || typeof addr === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function post(id: string, body: unknown) {
  return fetch(`${baseUrl}/api/stories/${id}/human-done`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/stories/:id/human-done", () => {
  it("replies to the latest human-request and clears review", async () => {
    const { requestHuman } = await import("../services/human-handoff.js");
    const request = await requestHuman("s", REQUEST);

    const res = await post("s", { note: "url is set" });
    expect(res.status).toBe(201);
    const message = (await res.json()) as {
      role: string;
      type: string;
      body: string;
      replyTo: string;
    };
    expect(message).toMatchObject({
      role: "human",
      type: "human-response",
      body: "url is set",
      replyTo: request.id,
    });
    expect(readStory().review).toBeUndefined();
  });

  it("accepts an empty body as no note", async () => {
    const { requestHuman } = await import("../services/human-handoff.js");
    const request = await requestHuman("s", REQUEST);

    const res = await post("s", {});
    expect(res.status).toBe(201);
    const message = (await res.json()) as { body: string; replyTo: string };
    expect(message.body).toBe("");
    expect(message.replyTo).toBe(request.id);
    expect(readStory().review).toBeUndefined();
  });

  it("refuses when review is not awaiting-human", async () => {
    const res = await post("s", { note: "nope" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("conflict");
    expect(body.error).toContain("review is not awaiting-human");
    expect(readStory().review).toBeUndefined();
  });

  it("refuses a non-story and an unknown id", async () => {
    writeIssue("t", {
      kind: "task",
      title: "Task",
      partOf: "s",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const task = await post("t", {});
    expect(task.status).toBe(400);
    expect(((await task.json()) as { error: string }).error).toContain(
      "not a story",
    );

    const missing = await post("missing", {});
    expect(missing.status).toBe(404);
  });

  it("refuses a non-string note", async () => {
    const res = await post("s", { note: 12 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/note/i);
  });
});
