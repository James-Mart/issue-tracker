import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const SHA1 = "0123456789abcdef0123456789abcdef01234567";
const SHA256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-commit-sha-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
  writeIssue("e", { kind: "epic", title: "E", partOf: "p", order: 0, createdAt: AT, updatedAt: AT });
  writeIssue("b", {
    kind: "story",
    title: "B",
    partOf: "e",
    merged: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("c", {
    kind: "task",
    title: "C",
    partOf: "b",
    status: "todo",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function loadService() {
  return import("./issues.js");
}

describe("commit sha", () => {
  it("accepts a full 40-character sha1 via update", async () => {
    const { update, read } = await loadService();
    await update("c", { commitSha: SHA1 });
    const detail = read("c");
    expect(detail.kind).toBe("task");
    if (detail.kind === "task") {
      expect(detail.commitSha).toBe(SHA1);
    }
  });

  it("accepts a full 64-character sha256 via update", async () => {
    const { update, read } = await loadService();
    await update("c", { commitSha: SHA256 });
    const detail = read("c");
    if (detail.kind === "task") {
      expect(detail.commitSha).toBe(SHA256);
    }
  });

  it("clears commitSha with null", async () => {
    const { update, read } = await loadService();
    await update("c", { commitSha: SHA1 });
    await update("c", { commitSha: null });
    const detail = read("c");
    if (detail.kind === "task") {
      expect(detail.commitSha).toBeUndefined();
    }
    const raw = JSON.parse(readFileSync(join(dir, "c", "issue.json"), "utf8"));
    expect(raw).not.toHaveProperty("commitSha");
  });

  it("rejects an abbreviated sha", async () => {
    const { update } = await loadService();
    await expect(update("c", { commitSha: "4019c25" })).rejects.toThrow(
      /invalid commit sha "4019c25"/,
    );
    const raw = JSON.parse(readFileSync(join(dir, "c", "issue.json"), "utf8"));
    expect(raw).not.toHaveProperty("commitSha");
  });

  it("rejects a 39-character sha", async () => {
    const { update } = await loadService();
    await expect(
      update("c", { commitSha: "0123456789abcdef0123456789abcdef0123456" }),
    ).rejects.toThrow(/invalid commit sha/);
  });

  it("rejects non-hex characters", async () => {
    const { update } = await loadService();
    await expect(
      update("c", { commitSha: "ghijghijghijghijghijghijghijghijghijghij" }),
    ).rejects.toThrow(/invalid commit sha/);
  });

  it("rejects uppercase hex", async () => {
    const { update } = await loadService();
    await expect(
      update("c", { commitSha: "0123456789ABCDEF0123456789ABCDEF01234567" }),
    ).rejects.toThrow(/invalid commit sha/);
  });

  it("rejects commitSha on a non-commit issue", async () => {
    const { update } = await loadService();
    await expect(update("b", { commitSha: SHA1 })).rejects.toThrow(/commitSha/i);
  });
});
