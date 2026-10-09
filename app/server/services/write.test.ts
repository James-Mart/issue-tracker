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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-write-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
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
    title: "A",
    partOf: "e",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("b", {
    kind: "story",
    title: "B",
    partOf: "e",
    order: 0,
    stackedOn: "a",
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

describe("validate-at-write on the service layer", () => {
  it("rejects an update that would introduce a stackedOn cycle", async () => {
    const { update } = await loadService();
    await expect(update("a", { stackedOn: "b" })).rejects.toThrow(/cycle/i);
  });

  it("rejects an update that would introduce an epic blockedBy cycle", async () => {
    // e2 already blocks on e; blocking e on e2 in turn would close the cycle.
    writeIssue("e2", {
      kind: "epic",
      title: "E2",
      partOf: "p",
      order: 1,
      blockedBy: ["e"],
      createdAt: AT,
      updatedAt: AT,
    });
    const { update } = await loadService();
    await expect(update("e", { blockedBy: ["e2"] })).rejects.toThrow(/cycle/i);
  });

  it("derives mergeBase from a merged parent's resolve (not branchName)", async () => {
    const { create, update, list } = await loadService();
    await update("a", {
      branchName: "feat/a",
      merged: true,
    });
    const child = await create({
      kind: "story",
      title: "Child",
      partOf: "e",
      stackedOn: "a",
    });
    expect(list().derived[child.id]?.mergeBase).toBe("main");
  });

  it("refuses rename of branchName when stacked children exist", async () => {
    const { update } = await loadService();
    await update("a", { branchName: "feat/a" });
    await expect(update("a", { branchName: "feat/a-renamed" })).rejects.toThrow(
      /cannot change branchName.*"a".*stacked children.*\bb\b/,
    );
  });
});

describe("cascade delete + reference repair on remove", () => {
  it("deletes a branch, its commits, and leaves the graph valid", async () => {
    writeIssue("c1", {
      kind: "task",
      title: "C1",
      partOf: "b",
      status: "todo",
      createdAt: AT,
      updatedAt: AT,
    });
    const { remove, list } = await loadService();
    const result = await remove("b");
    expect([...result.deleted].sort()).toEqual(["b", "c1"]);

    const after = list();
    expect(after.problems).toEqual([]);
    expect(after.issues.map((i) => i.id).sort()).toEqual(["a", "e", "p"]);
  });

  it("splices a dependent branch when its fork point is deleted", async () => {
    const { remove, list } = await loadService();
    // b.stackedOn === "a"; deleting "a" must repoint b to main (stackedOn cleared).
    const result = await remove("a");
    expect(result.deleted).toEqual(["a"]);
    expect(result.repointed).toEqual([{ id: "b", to: undefined }]);

    const after = list();
    expect(after.problems).toEqual([]);
    const b = after.issues.find((i) => i.id === "b");
    expect(b && b.kind === "story" ? b.stackedOn : "missing").toBeUndefined();
    expect(after.derived.b?.mergeBase).toBe("main");
    expect(
      JSON.parse(readFileSync(join(dir, "b", "issue.json"), "utf8")).mergeBase,
    ).toBeUndefined();
  });
});
