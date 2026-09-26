import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const SECRET_VALUE = "sk_test_super_secret_value";

let dir: string;
let home: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-secrets-route-"));
  home = mkdtempSync(join(tmpdir(), "issue-tracker-secrets-home-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  vi.stubEnv("HOME", home);

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("story-1", {
    kind: "story",
    title: "Story",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });

  const { setSecret } = await import("../services/secret-store.js");
  setSecret("p", "STRIPE_SANDBOX_KEY", SECRET_VALUE);

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
  rmSync(home, { recursive: true, force: true });
});

describe("GET /api/projects/:id/secrets", () => {
  it("returns key names and no secret value", async () => {
    const res = await fetch(`${baseUrl}/api/projects/p/secrets`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ keys: ["STRIPE_SANDBOX_KEY"] });
    expect(body).not.toContain(SECRET_VALUE);
  });

  it("returns an empty list when the project has no secrets", async () => {
    const { deleteSecret } = await import("../services/secret-store.js");
    deleteSecret("p", "STRIPE_SANDBOX_KEY");
    const res = await fetch(`${baseUrl}/api/projects/p/secrets`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keys: [] });
  });

  it("refuses a non-project id", async () => {
    const res = await fetch(`${baseUrl}/api/projects/story-1/secrets`);
    expect(res.status).toBe(404);
  });
});
