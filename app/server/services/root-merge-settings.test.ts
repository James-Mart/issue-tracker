import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function rawIssue(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-root-merge-settings-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    trunk: "main",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("root", {
    kind: "story",
    title: "Root",
    partOf: "p",
    order: 0,
    merged: false,
    prUrl: "http://pr/1",
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("setRootMergeSettings", () => {
  it("refuses a locked root on both fields with the derived reason", async () => {
    const { setRootMergeSettings } = await import("./root-merge-settings.js");
    const { list } = await import("./issues.js");
    const reason =
      "Locked while this Story has an open pull request. Close it to change the base.";
    expect(list().derived.root?.mergeSettingsLock).toEqual({ locked: true, reason });
    await expect(
      setRootMergeSettings("root", { mergeBase: "release" }, { mode: "human" }),
    ).rejects.toThrow(reason);
    await expect(
      setRootMergeSettings("root", { mergePolicy: "manual" }, { mode: "human" }),
    ).rejects.toThrow(reason);
    expect(rawIssue("root")).not.toHaveProperty("mergeBaseOverride");
    expect(rawIssue("root")).not.toHaveProperty("mergePolicy");
  });
});
