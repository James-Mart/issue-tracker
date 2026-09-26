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

describe("PUT /api/projects/:id/secrets/:key", () => {
  it("sets a secret and returns key names without the value", async () => {
    const value = "sk_live_brand_new_value";
    const res = await fetch(`${baseUrl}/api/projects/p/secrets/NEW_KEY`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({
      keys: ["NEW_KEY", "STRIPE_SANDBOX_KEY"],
    });
    expect(body).not.toContain(value);
    expect(body).not.toContain(SECRET_VALUE);

    const { readSecretsForRuntime } = await import("../services/secret-store.js");
    expect(readSecretsForRuntime("p").NEW_KEY).toBe(value);
  });

  it("replaces a secret without returning the new or previous value", async () => {
    const value = "sk_live_replacement_value";
    const res = await fetch(
      `${baseUrl}/api/projects/p/secrets/STRIPE_SANDBOX_KEY`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ keys: ["STRIPE_SANDBOX_KEY"] });
    expect(body).not.toContain(value);
    expect(body).not.toContain(SECRET_VALUE);

    const listed = await fetch(`${baseUrl}/api/projects/p/secrets`);
    const listedBody = await listed.text();
    expect(JSON.parse(listedBody)).toEqual({ keys: ["STRIPE_SANDBOX_KEY"] });
    expect(listedBody).not.toContain(value);
    expect(listedBody).not.toContain(SECRET_VALUE);
  });

  it("refuses a non-string value without echoing it", async () => {
    const res = await fetch(`${baseUrl}/api/projects/p/secrets/NEW_KEY`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { leak: "nested-secret-value" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("body must be { value: string }");
    expect(body).not.toContain("nested-secret-value");
  });

  it("refuses an invalid key without echoing the value", async () => {
    const value = "should-not-leak-from-invalid-key";
    const res = await fetch(`${baseUrl}/api/projects/p/secrets/not-a-key`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("invalid secret key");
    expect(body).not.toContain(value);
    expect(body).not.toContain(SECRET_VALUE);
  });

  it("refuses a non-project id without storing the value", async () => {
    const value = "story-should-not-store-this";
    const res = await fetch(`${baseUrl}/api/projects/story-1/secrets/NEW_KEY`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain(value);

    const { listSecretKeys } = await import("../services/secret-store.js");
    expect(listSecretKeys("story-1")).toEqual([]);
  });
});

describe("DELETE /api/projects/:id/secrets/:key", () => {
  it("removes a secret and returns the remaining keys without the value", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/p/secrets/STRIPE_SANDBOX_KEY`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ keys: [] });
    expect(body).not.toContain(SECRET_VALUE);

    const { listSecretKeys } = await import("../services/secret-store.js");
    expect(listSecretKeys("p")).toEqual([]);
  });

  it("refuses an invalid key without echoing a body value", async () => {
    const res = await fetch(`${baseUrl}/api/projects/p/secrets/not-a-key`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "delete-should-not-echo" }),
    });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("invalid secret key");
    expect(body).not.toContain("delete-should-not-echo");
    expect(body).not.toContain(SECRET_VALUE);
  });

  it("refuses a non-project id", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/story-1/secrets/STRIPE_SANDBOX_KEY`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain(SECRET_VALUE);
  });
});
