import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXECUTION_GATE_STAKEHOLDER_ERROR } from "../services/patch.js";

const AT = "2026-08-10T12:00:00.000Z";

let dir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-idea-gates-route-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("gate-me", {
    kind: "idea",
    title: "Gate me",
    partOf: "p",
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("gated-auto", {
    kind: "idea",
    title: "Gated auto",
    partOf: "p",
    order: 1,
    archived: false,
    stakeholder: "composer-2.5",
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

describe("Idea gate fields HTTP API", () => {
  it("refuses executionGate when the Idea has no stakeholder", async () => {
    const res = await fetch(`${baseUrl}/api/issues/gate-me`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionGate: true }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: EXECUTION_GATE_STAKEHOLDER_ERROR,
      code: "conflict",
    });
  });

  it("accepts executionGate when a stakeholder is set", async () => {
    const res = await fetch(`${baseUrl}/api/issues/gated-auto`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionGate: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { executionGate?: boolean };
    expect(body.executionGate).toBe(true);
  });
});
