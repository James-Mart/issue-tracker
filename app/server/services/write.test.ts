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

  it("rejects an update with a dangling stackedOn", async () => {
    const { update } = await loadService();
    await expect(update("b", { stackedOn: "ghost" })).rejects.toThrow(
      /unknown issue/,
    );
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

  it("rejects a create whose stackedOn is not a story", async () => {
    const { create } = await loadService();
    await expect(
      create({ kind: "story", title: "C", partOf: "e", stackedOn: "e" }),
    ).rejects.toThrow(/must be a story/);
  });

  it("accepts a valid stackedOn update", async () => {
    const { update } = await loadService();
    const record = await update("a", { branchName: "feat/a" });
    expect(record.kind === "story" && record.branchName).toBe("feat/a");
  });

  it("does not persist mergeBase; derive exposes root as main", async () => {
    const { create, list } = await loadService();
    const record = await create({ kind: "story", title: "Root", partOf: "e" });
    expect(
      JSON.parse(readFileSync(join(dir, record.id, "issue.json"), "utf8"))
        .mergeBase,
    ).toBeUndefined();
    expect(list().derived[record.id]?.mergeBase).toBe("main");
  });

  it("derives mergeBase from a named parent's branchName on stacked create", async () => {
    const { create, update, list } = await loadService();
    await update("a", { branchName: "feat/a" });
    const child = await create({
      kind: "story",
      title: "Child",
      partOf: "e",
      stackedOn: "a",
    });
    expect(
      JSON.parse(readFileSync(join(dir, child.id, "issue.json"), "utf8"))
        .mergeBase,
    ).toBeUndefined();
    expect(list().derived[child.id]?.mergeBase).toBe("feat/a");
  });

  it("leaves derived mergeBase unset when stacking on an unnamed parent", async () => {
    const { create, list } = await loadService();
    const child = await create({
      kind: "story",
      title: "Child",
      partOf: "e",
      stackedOn: "a",
    });
    expect(list().derived[child.id]?.mergeBase).toBeUndefined();
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

  it("re-derives mergeBase when stackedOn retargets to a merged parent", async () => {
    writeIssue("merged-parent", {
      kind: "story",
      title: "Merged",
      partOf: "e",
      order: 1,
      branchName: "feat/merged",
      merged: true,
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
    const { update, list } = await loadService();
    await update("b", { stackedOn: "merged-parent" });
    expect(list().derived.b?.mergeBase).toBe("main");
    expect(
      JSON.parse(readFileSync(join(dir, "b", "issue.json"), "utf8")).mergeBase,
    ).toBeUndefined();
  });

  it("re-derives mergeBase to branchName when stackedOn retargets to a named unmerged parent", async () => {
    writeIssue("named", {
      kind: "story",
      title: "Named",
      partOf: "e",
      order: 1,
      branchName: "feat/named",
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
    const { update, list } = await loadService();
    await update("b", { stackedOn: "named" });
    expect(list().derived.b?.mergeBase).toBe("feat/named");
  });

  it("clears derived mergeBase when stackedOn retargets to an unnamed parent", async () => {
    writeIssue("unnamed", {
      kind: "story",
      title: "Unnamed",
      partOf: "e",
      order: 1,
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
    const { update, list } = await loadService();
    await update("b", { stackedOn: "unnamed" });
    expect(list().derived.b?.mergeBase).toBeUndefined();
  });

  it("derives mergeBase to main when unstacked (stackedOn cleared)", async () => {
    writeIssue("b", {
      kind: "story",
      title: "B",
      partOf: "e",
      order: 0,
      stackedOn: "a",
      createdAt: AT,
      updatedAt: AT,
    });
    const { update, list } = await loadService();
    const moved = await update("b", { stackedOn: null });
    expect(moved.kind === "story" && moved.stackedOn).toBeUndefined();
    expect(list().derived.b?.mergeBase).toBe("main");
  });

  it("does not write mergeBase on first set-branch-name (derive updates)", async () => {
    const { update, list } = await loadService();
    expect(list().derived.b?.mergeBase).toBeUndefined();
    await update("a", { branchName: "feat/a" });
    const child = JSON.parse(
      readFileSync(join(dir, "b", "issue.json"), "utf8"),
    ) as { mergeBase?: string };
    expect(child.mergeBase).toBeUndefined();
    expect(list().derived.b?.mergeBase).toBe("feat/a");
  });

  it("does not write child mergeBase on set-merged (derive updates)", async () => {
    const { update, list } = await loadService();
    await update("a", { branchName: "feat/a" });
    expect(list().derived.b?.mergeBase).toBe("feat/a");
    await update("a", { merged: true });
    const child = JSON.parse(
      readFileSync(join(dir, "b", "issue.json"), "utf8"),
    ) as { mergeBase?: string };
    expect(child.mergeBase).toBeUndefined();
    expect(list().derived.b?.mergeBase).toBe("main");
  });

  it("refuses rename of branchName when stacked children exist", async () => {
    const { update } = await loadService();
    await update("a", { branchName: "feat/a" });
    await expect(update("a", { branchName: "feat/a-renamed" })).rejects.toThrow(
      /cannot change branchName.*"a".*stacked children.*\bb\b/,
    );
  });

  it("allows a same-value set-branch-name no-op even with stacked children", async () => {
    const { update } = await loadService();
    await update("a", { branchName: "feat/a" });
    const again = await update("a", { branchName: "feat/a" });
    expect(again.kind === "story" && again.branchName).toBe("feat/a");
  });

  it("allows rename of branchName when there are no stacked children", async () => {
    const { update } = await loadService();
    await update("b", { stackedOn: null });
    await update("a", { branchName: "feat/a" });
    const renamed = await update("a", { branchName: "feat/a2" });
    expect(renamed.kind === "story" && renamed.branchName).toBe("feat/a2");
  });

  it("appends order on create", async () => {
    const { create } = await loadService();
    const first = await create({ kind: "task", title: "C1", partOf: "a" });
    const second = await create({ kind: "task", title: "C2", partOf: "a" });
    expect(first.kind === "task" && first.order).toBe(0);
    expect(second.kind === "task" && second.order).toBe(1);
  });

  it("re-appends order when reparenting without an explicit order patch", async () => {
    const { create, update } = await loadService();
    const commit = await create({ kind: "task", title: "Move me", partOf: "a" });
    const moved = await update(commit.id, { partOf: "b" });
    expect(moved.kind === "task" && moved.order).toBe(0);
  });
});

// Moving a Branch between fork points (`set-stacked-on`) changes its sibling
// group, so its old `order` can collide in the destination bucket. These pin the
// re-append behavior that keeps restacks/unstacks/reparents from being refused.
// Seed (from beforeEach): epic e with root branch a (order 0) and b stacked on a
// (order 0).
describe("sibling order — restack / unstack / reparent", () => {
  function orderOf(id: string): number {
    return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8")).order;
  }

  it("re-appends a branch's order when restacked onto a fork point that already has children", async () => {
    // a2 is a second root branch (order 1) already carrying a child x (order 0).
    writeIssue("a2", {
      kind: "story",
      title: "A2",
      partOf: "e",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("x", {
      kind: "story",
      title: "X",
      partOf: "e",
      stackedOn: "a2",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const { update, list } = await loadService();
    // b (order 0, stacked on a) moves under a2, whose children already hold
    // order 0 (x). Without re-append b would collide; it must land at order 1.
    const moved = await update("b", { stackedOn: "a2" });
    expect(moved.kind === "story" && moved.stackedOn).toBe("a2");
    expect(orderOf("b")).toBe(1);
    expect(orderOf("x")).toBe(0);
    expect(list().problems).toEqual([]);
  });

  it("re-appends among the epic's roots when a branch is unstacked (stackedOn cleared)", async () => {
    // b (stacked on a) becomes a root branch; roots currently hold a (order 0),
    // so b appends at order 1 rather than keeping its child-bucket order 0.
    const { update, list } = await loadService();
    const moved = await update("b", { stackedOn: null });
    expect(moved.kind === "story" && moved.stackedOn).toBeUndefined();
    expect(orderOf("b")).toBe(1);
    expect(orderOf("a")).toBe(0);
    expect(list().problems).toEqual([]);
  });

  it("gives order 0 when restacked into a fork point with no other children", async () => {
    writeIssue("a2", {
      kind: "story",
      title: "A2",
      partOf: "e",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    const { update, list } = await loadService();
    // a2 has no children yet, so b appends at order 0 (a fresh bucket).
    await update("b", { stackedOn: "a2" });
    expect(orderOf("b")).toBe(0);
    expect(list().problems).toEqual([]);
  });

  it("honors an explicit order patch during a restack (no re-append override)", async () => {
    writeIssue("a2", {
      kind: "story",
      title: "A2",
      partOf: "e",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    const { update } = await loadService();
    await update("b", { stackedOn: "a2", order: 7 });
    expect(orderOf("b")).toBe(7);
  });

  it("leaves order untouched when set-stacked-on is a no-op (same group)", async () => {
    const { update } = await loadService();
    // b is already stacked on a; re-setting the same fork point must not shuffle.
    await update("b", { stackedOn: "a" });
    expect(orderOf("b")).toBe(0);
  });

  it("re-appends among the destination epic's roots when a branch is reparented across epics", async () => {
    writeIssue("e2", {
      kind: "epic",
      title: "E2",
      partOf: "p",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("e2b", {
      kind: "story",
      title: "E2B",
      partOf: "e2",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    // A lone root branch in e (no children, no stackedOn) so the move is clean.
    writeIssue("lone", {
      kind: "story",
      title: "Lone",
      partOf: "e",
      order: 2,
      createdAt: AT,
      updatedAt: AT,
    });
    const { update, list } = await loadService();
    await update("lone", { partOf: "e2" });
    // e2 roots already hold e2b (order 0), so lone appends at order 1.
    expect(orderOf("lone")).toBe(1);
    expect(orderOf("e2b")).toBe(0);
    expect(list().problems).toEqual([]);
  });
});

describe("idea create / reparent / shared order", () => {
  it("creates an idea under a project without assignee or attention fields", async () => {
    const { create } = await loadService();
    const record = await create({
      kind: "idea",
      title: "Capture me",
      partOf: "p",
    });
    expect(record.kind).toBe("idea");
    if (record.kind === "idea") {
      expect(record.partOf).toBe("p");
      expect(record.archived).toBe(false);
      expect("assignee" in record).toBe(false);
      expect("needsAttention" in record).toBe(false);
      expect("attentionReason" in record).toBe(false);
    }
  });

  it("creates epic and story without assignee", async () => {
    const { create } = await loadService();
    const epic = await create({
      kind: "epic",
      title: "Epic",
      partOf: "p",
    });
    expect(epic.kind).toBe("epic");
    if (epic.kind === "epic") {
      expect("assignee" in epic).toBe(false);
    }
    const story = await create({
      kind: "story",
      title: "Story",
      partOf: "e",
    });
    expect(story.kind).toBe("story");
    if (story.kind === "story") {
      expect("assignee" in story).toBe(false);
    }
  });

  it("shares order with an epic in the same project on create", async () => {
    // Seed epic "e" already holds order 0 under project "p".
    const { create } = await loadService();
    const idea = await create({
      kind: "idea",
      title: "Next slot",
      partOf: "p",
    });
    expect(idea.kind === "idea" && idea.order).toBe(1);
  });

  it("re-appends order when an idea is reparented to another project", async () => {
    writeIssue("p2", {
      kind: "project",
      title: "P2",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("e2", {
      kind: "epic",
      title: "E2",
      partOf: "p2",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const { create, update, list } = await loadService();
    const idea = await create({
      kind: "idea",
      title: "Move me",
      partOf: "p",
    });
    // Under p: epic e at 0, so idea appended at 1. Move to p2 where e2 holds 0.
    expect(idea.kind === "idea" && idea.order).toBe(1);
    const moved = await update(idea.id, { partOf: "p2" });
    expect(moved.kind === "idea" && moved.partOf).toBe("p2");
    expect(moved.kind === "idea" && moved.order).toBe(1);
    expect(list().problems).toEqual([]);
  });

  it("rejects an idea whose partOf is not a project", async () => {
    const { create } = await loadService();
    await expect(
      create({ kind: "idea", title: "Bad parent", partOf: "e" }),
    ).rejects.toThrow(/must be a project/);
  });

  it("removes an idea without touching sibling epics", async () => {
    const { create, remove, list } = await loadService();
    const idea = await create({
      kind: "idea",
      title: "Disposable",
      partOf: "p",
    });
    const result = await remove(idea.id);
    expect(result.deleted).toEqual([idea.id]);
    expect(list().issues.map((i) => i.id).sort()).toEqual(["a", "b", "e", "p"]);
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
    writeIssue("b", {
      kind: "story",
      title: "B",
      partOf: "e",
      order: 0,
      stackedOn: "a",
      createdAt: AT,
      updatedAt: AT,
    });
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

  it("re-derives mergeBase when delete-repoint splices onto a surviving parent", async () => {
    // a (named root) <- b <- child. Deleting b splices child onto a.
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      order: 0,
      branchName: "feat/a",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("b", {
      kind: "story",
      title: "B",
      partOf: "e",
      order: 0,
      stackedOn: "a",
      branchName: "feat/b",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("child", {
      kind: "story",
      title: "Child",
      partOf: "e",
      order: 0,
      stackedOn: "b",
      createdAt: AT,
      updatedAt: AT,
    });
    const { remove, list } = await loadService();
    const result = await remove("b");
    expect(result.deleted).toEqual(["b"]);
    expect(result.repointed).toEqual([{ id: "child", to: "a" }]);

    const after = list();
    expect(after.problems).toEqual([]);
    const child = after.issues.find((i) => i.id === "child");
    expect(child && child.kind === "story" ? child.stackedOn : "missing").toBe(
      "a",
    );
    expect(after.derived.child?.mergeBase).toBe("feat/a");
    expect(
      JSON.parse(readFileSync(join(dir, "child", "issue.json"), "utf8"))
        .mergeBase,
    ).toBeUndefined();
  });

  it("drops a deleted epic from another epic's blockedBy", async () => {
    writeIssue("victim", {
      kind: "epic",
      title: "Victim",
      partOf: "p",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("keeper", {
      kind: "epic",
      title: "Keeper",
      partOf: "p",
      order: 2,
      blockedBy: ["victim"],
      createdAt: AT,
      updatedAt: AT,
    });
    const { remove, list } = await loadService();
    // Deleting the blocking epic drops it from keeper.blockedBy.
    await remove("victim");

    const after = list();
    expect(after.problems).toEqual([]);
    const keeper = after.issues.find((i) => i.id === "keeper");
    expect(keeper && "blockedBy" in keeper ? keeper.blockedBy : ["unexpected"]).toEqual([]);
  });

  it("deletes an entire epic subtree", async () => {
    const { remove, list } = await loadService();
    const result = await remove("e");
    expect([...result.deleted].sort()).toEqual(["a", "b", "e"]);
    expect(list().issues.map((i) => i.id)).toEqual(["p"]);
  });

  it("deletes a project and its entire epic subtree", async () => {
    const { remove, list } = await loadService();
    const result = await remove("p");
    expect([...result.deleted].sort()).toEqual(["a", "b", "e", "p"]);
    expect(list().issues).toEqual([]);
  });
});

describe("project labels catalog and assignments", () => {
  function readJson(id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
  }

  it("refuses assigning a label absent from the Project catalog", async () => {
    const { update } = await loadService();
    await update("p", {
      labels: [{ id: "bug", color: "#ff0000" }],
    });
    await expect(update("e", { labels: ["ghost"] })).rejects.toThrow(
      /unknown catalog id/,
    );
  });

  it("accepts a closed-catalog assignment", async () => {
    const { update } = await loadService();
    await update("p", {
      labels: [{ id: "bug", color: "#ff0000" }],
    });
    const epic = await update("e", { labels: ["bug"] });
    expect(epic.kind === "epic" && epic.labels).toEqual(["bug"]);
  });

  it("strips removed catalog ids from assignments in the same write", async () => {
    const { update } = await loadService();
    await update("p", {
      labels: [
        { id: "bug", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    await update("e", { labels: ["bug", "feat"] });
    await update("a", { labels: ["bug"] });

    await update("p", {
      labels: [{ id: "feat", color: "#00ff00" }],
    });

    expect(readJson("e").labels).toEqual(["feat"]);
    expect(readJson("a").labels).toEqual([]);
    expect(readJson("p").labels).toEqual([{ id: "feat", color: "#00ff00" }]);
  });

  it("rewrites assignments on catalog rename and refuses collisions", async () => {
    const { update, renameProjectLabel } = await loadService();
    await update("p", {
      labels: [
        { id: "bug", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    await update("e", { labels: ["bug", "feat"] });
    await update("a", { labels: ["bug"] });

    await renameProjectLabel("p", "bug", "defect");
    expect(readJson("p").labels).toEqual([
      { id: "defect", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    ]);
    expect(readJson("e").labels).toEqual(["defect", "feat"]);
    expect(readJson("a").labels).toEqual(["defect"]);

    await expect(renameProjectLabel("p", "defect", "feat")).rejects.toThrow(
      /already exists/,
    );
  });

  it("rewrites assignments when a same-length labels patch renames one id", async () => {
    const { update } = await loadService();
    await update("p", {
      labels: [
        { id: "bug", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    await update("e", { labels: ["bug", "feat"] });
    await update("a", { labels: ["bug"] });

    await update("p", {
      labels: [
        { id: "defect", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });

    expect(readJson("p").labels).toEqual([
      { id: "defect", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    ]);
    expect(readJson("e").labels).toEqual(["defect", "feat"]);
    expect(readJson("a").labels).toEqual(["defect"]);
  });

  it("rejects labels on a Task", async () => {
    writeIssue("t", {
      kind: "task",
      title: "T",
      partOf: "a",
      order: 0,
      status: "todo",
      createdAt: AT,
      updatedAt: AT,
    });
    const { update } = await loadService();
    await update("p", {
      labels: [{ id: "bug", color: "#ff0000" }],
    });
    await expect(update("t", { labels: ["bug"] })).rejects.toThrow(
      /not valid for a task/,
    );
  });
});
