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

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-archived-list-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("live", {
    kind: "story",
    title: "Live",
    partOf: "p",
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("old", {
    kind: "epic",
    title: "Old",
    partOf: "p",
    order: 1,
    archived: true,
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

async function ids(path: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}${path}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { issues: { id: string }[] };
  return body.issues.map((issue) => issue.id).sort();
}

describe("GET /api/issues archived", () => {
  it("returns non-archived issues when the flag is omitted", async () => {
    expect(await ids("/api/issues")).toEqual(["live", "p"]);
  });

  it("returns the full list for archived=include", async () => {
    expect(await ids("/api/issues?archived=include")).toEqual([
      "live",
      "old",
      "p",
    ]);
  });

  it("returns archived issues for archived=only", async () => {
    expect(await ids("/api/issues?archived=only")).toEqual(["old"]);
  });

  it("rejects an unknown archived value", async () => {
    const res = await fetch(`${baseUrl}/api/issues?archived=true`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/include or only/);
  });
});
