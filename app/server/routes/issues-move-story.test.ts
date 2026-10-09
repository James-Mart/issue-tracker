import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

async function postMoveStory(
  id: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/issues/${id}/move-story`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-move-story-route-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e1", {
    kind: "epic",
    title: "E1",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("a", {
    kind: "story",
    title: "A",
    partOf: "e1",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("b", {
    kind: "story",
    title: "B",
    partOf: "e1",
    stackedOn: "a",
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

describe("POST /api/issues/:id/move-story", () => {
  it("returns 400 for cycle rejection", async () => {
    const { status, json } = await postMoveStory("a", { target: "b" });
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: expect.stringMatching(/cycle/i) });
  });
});
