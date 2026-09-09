import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPEND_TO_MERGED_ERROR,
} from "../services/patch.js";
import {
  UPDATE_FROM_MERGE_BASE_NO_BRANCH_ERROR,
  UPDATE_FROM_MERGE_BASE_NO_MERGE_BASE_ERROR,
} from "../services/merge-base-task.js";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

async function postUpdateFromMergeBase(
  id: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/issues/${id}/update-from-merge-base`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-update-merge-base-route-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "E",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("a", {
    kind: "story",
    title: "Story A",
    partOf: "e",
    merged: false,
    branchName: "feat/a",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("keep", {
    kind: "task",
    title: "Keep",
    partOf: "a",
    status: "done",
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

describe("POST /api/issues/:id/update-from-merge-base", () => {
  it("returns 201 with the created Task on success", async () => {
    const { status, json } = await postUpdateFromMergeBase("a");
    expect(status).toBe(201);

    const task = json as Record<string, unknown>;
    expect(task.id).toBe("update-from-merge-base");
    expect(task.kind).toBe("task");
    expect(task.partOf).toBe("a");
    expect(task.appended).toBe(true);
    expect(task.order).toBe(1);
    expect(typeof task.description).toBe("string");
    expect(task.description).toContain("feat/a");
    expect(task.description).toContain("main");

    expect(existsSync(join(dir, "update-from-merge-base", "issue.json"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "keep"))).toBe(true);
  });

  it("returns 409 with the merged Story refusal reason", async () => {
    writeIssue("a", {
      kind: "story",
      title: "Story A",
      partOf: "e",
      merged: true,
      branchName: "feat/a",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    const { status, json } = await postUpdateFromMergeBase("a");
    expect(status).toBe(409);
    expect(json).toEqual({ error: APPEND_TO_MERGED_ERROR("a") });
    expect(existsSync(join(dir, "update-from-merge-base"))).toBe(false);
  });

  it("returns 409 with the no-branch refusal reason", async () => {
    writeIssue("a", {
      kind: "story",
      title: "Story A",
      partOf: "e",
      merged: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    const { status, json } = await postUpdateFromMergeBase("a");
    expect(status).toBe(409);
    expect(json).toEqual({
      error: UPDATE_FROM_MERGE_BASE_NO_BRANCH_ERROR("a"),
    });
    expect(existsSync(join(dir, "update-from-merge-base"))).toBe(false);
  });

  it("returns 409 with the no mergeBase refusal reason", async () => {
    writeIssue("b", {
      kind: "story",
      title: "Stacked",
      partOf: "e",
      stackedOn: "a",
      branchName: "feat/b",
      merged: false,
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("a", {
      kind: "story",
      title: "Story A",
      partOf: "e",
      merged: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    const { status, json } = await postUpdateFromMergeBase("b");
    expect(status).toBe(409);
    expect(json).toEqual({
      error: UPDATE_FROM_MERGE_BASE_NO_MERGE_BASE_ERROR("b"),
    });
    expect(existsSync(join(dir, "update-from-merge-base"))).toBe(false);
  });
});
