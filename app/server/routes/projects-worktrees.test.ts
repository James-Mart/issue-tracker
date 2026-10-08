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
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-worktrees-route-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("other", {
    kind: "project",
    title: "Other",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s", {
    kind: "story",
    title: "S",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("elsewhere", {
    kind: "story",
    title: "Elsewhere",
    partOf: "other",
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

describe("GET /api/projects/:projectId/worktrees", () => {
  it("returns quiet git state and omits other projects", async () => {
    const res = await fetch(`${baseUrl}/api/projects/p/worktrees`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      worktrees: {
        s: {
          exists: false,
          uncommittedCount: 0,
          atRiskCommitCount: 0,
          retained: false,
          locked: false,
          dirty: false,
          dirtyPaths: [],
          ahead: 0,
          behind: 0,
        },
      },
    });
  });

  it("404s when the id is not a project", async () => {
    const res = await fetch(`${baseUrl}/api/projects/s/worktrees`);
    expect(res.status).toBe(404);
  });

  it("leaves worktree off GET /api/issues", async () => {
    const res = await fetch(`${baseUrl}/api/issues`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      derived: Record<string, { worktree?: unknown }>;
    };
    expect(body.derived.s?.worktree).toBeUndefined();
  });
});
