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

function readJson(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-reorder-board-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e1", {
    kind: "epic",
    title: "E1",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("idea1", {
    kind: "idea",
    title: "Idea",
    partOf: "p",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("solo", {
    kind: "story",
    title: "Solo",
    partOf: "p",
    order: 2,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("nested", {
    kind: "story",
    title: "Nested",
    partOf: "e1",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function load() {
  return import("./reorder-board.js");
}

async function loadList() {
  return import("./issues.js");
}

describe("reorderBoardChild", () => {
  it("inserts a board root before another and renumbers the shared group", async () => {
    const { reorderBoardChild } = await load();
    const { list } = await loadList();

    const result = await reorderBoardChild("solo", "e1");
    expect(result.order).toEqual(["solo", "e1", "idea1"]);
    expect(readJson("solo").order).toBe(0);
    expect(readJson("e1").order).toBe(1);
    expect(readJson("idea1").order).toBe(2);
    expect(list().problems).toEqual([]);
  });

  it("reorders an epic before a project-level story", async () => {
    const { reorderBoardChild } = await load();
    const result = await reorderBoardChild("e1", "solo");
    expect(result.order).toEqual(["idea1", "e1", "solo"]);
    expect(readJson("idea1").order).toBe(0);
    expect(readJson("e1").order).toBe(1);
    expect(readJson("solo").order).toBe(2);
  });

  it("is a no-op when already immediately before the target", async () => {
    const { reorderBoardChild } = await load();
    const before = readJson("e1");
    const result = await reorderBoardChild("e1", "idea1");
    expect(result.order).toEqual(["e1", "idea1", "solo"]);
    expect(readJson("e1")).toEqual(before);
  });

  it("rejects epic-child stories and cross-project pairs", async () => {
    const { reorderBoardChild } = await load();
    await expect(reorderBoardChild("nested", "e1")).rejects.toThrow(
      /project board root/,
    );
    await expect(reorderBoardChild("e1", "nested")).rejects.toThrow(
      /project board root/,
    );
  });

  it("rejects story→story reorder (restack owns that gesture)", async () => {
    writeIssue("peer", {
      kind: "story",
      title: "Peer",
      partOf: "p",
      order: 3,
      createdAt: AT,
      updatedAt: AT,
    });
    const { reorderBoardChild } = await load();
    await expect(reorderBoardChild("solo", "peer")).rejects.toThrow(
      /move-story to restack/,
    );
  });
});
