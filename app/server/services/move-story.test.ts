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
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-move-story-"));
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
  writeIssue("e2", {
    kind: "epic",
    title: "E2",
    partOf: "p",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  // e1 stack: a (root) -> b -> c
  writeIssue("a", {
    kind: "story",
    title: "A",
    partOf: "e1",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("b", {
    kind: "story",
    title: "B",
    partOf: "e1",
    stackedOn: "a",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("c", {
    kind: "story",
    title: "C",
    partOf: "e1",
    stackedOn: "b",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  // e2 has a root branch to restack onto / collide orders with
  writeIssue("x", {
    kind: "story",
    title: "X",
    partOf: "e2",
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
  return import("./move-story.js");
}

async function loadList() {
  return import("./issues.js");
}

describe("moveStory", () => {
  it("moves a whole stack across epics when restacking onto a foreign branch", async () => {
    const { moveStory } = await load();
    const { list } = await loadList();

    const result = await moveStory("b", "x");
    expect(result.moved).toEqual(["b", "c"]);

    expect(readJson("b").partOf).toBe("e2");
    expect(readJson("b").stackedOn).toBe("x");
    expect(readJson("c").partOf).toBe("e2");
    expect(readJson("c").stackedOn).toBe("b");
    // Parent left behind in e1
    expect(readJson("a").partOf).toBe("e1");
    expect(list().problems).toEqual([]);
  });

  it("rejects restacking onto a stackedOn descendant", async () => {
    const { moveStory } = await load();
    await expect(moveStory("a", "c")).rejects.toThrow(/cycle/i);
    // Nothing written
    expect(readJson("a").stackedOn).toBeUndefined();
    expect(readJson("b").stackedOn).toBe("a");
  });
});
