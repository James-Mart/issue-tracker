import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";

let dir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-outline-mockups-http-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("spec", {
    kind: "outline",
    title: "Spec",
    partOf: "p",
    bodyVersion: 1,
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeFileSync(join(dir, "spec", "description.md"), "# Spec\n");

  const { createApp } = await import("../app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("expected TCP listen address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(dir, { recursive: true, force: true });
});

it("reads mockup stack status for an outline", async () => {
  const res = await fetch(`${baseUrl}/api/issues/spec/mockups`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    phase: "stopped",
    canRestore: false,
    treeMatchesPack: false,
    authorRun: "clean",
    directions: [],
  });
});

it("refuses to start without a bound session", async () => {
  const res = await fetch(`${baseUrl}/api/issues/spec/mockups`, { method: "POST" });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/no bound mockup session/);
});
