import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import { expect, vi } from "vitest";

export const AT = "2026-07-09T14:00:00.000Z";

export type GuestStore = { root: string; issuesDir: string };

/** Fresh temp store with `ISSUES_DIR` and `ISSUE_TRACKER_GUEST=1` stubbed and modules reset. */
export function createGuestStore(prefix: string): GuestStore {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  vi.stubEnv("ISSUE_TRACKER_GUEST", "1");
  return { root, issuesDir };
}

/** Unstub env, close the server when one was started, and remove the store. */
export async function disposeGuestStore(
  store: GuestStore,
  server: Server | undefined,
): Promise<void> {
  vi.unstubAllEnvs();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  rmSync(store.root, { recursive: true, force: true });
}

export function writeIssue(
  issuesDir: string,
  id: string,
  body: Record<string, unknown>,
): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, createdAt: AT, updatedAt: AT, ...body }),
  );
}

export function readIssue(
  issuesDir: string,
  id: string,
): Record<string, unknown> {
  return JSON.parse(readFileSync(join(issuesDir, id, "issue.json"), "utf8"));
}

export async function listen(
  app: Express,
): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

export async function expectGuest(res: Response, error: string): Promise<void> {
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error, code: "guest" });
}
