import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import {
  AT,
  dir,
  loadService,
  readIssue,
  useApplyTestFixtures,
  writeIssue,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — prune by default", () => {
  it("removes an omitted epic subtree (cascade) and repairs an out-of-scope epic's blockedBy", async () => {
    // p1 has two epics: e1 (kept, branch b1) and e-victim (to prune). Under
    // e-victim: branch b2 with a commit (c2) and a stacked child branch (b2s),
    // so pruning the epic cascades through both the commit-under-branch case and
    // a stacked branch. b2s carries a comments.jsonl so we can prove the whole node
    // directory is gone, not just its id absent from list(). p2's epic e-out
    // blocks on e-victim — the only cross-Epic edge — so pruning e-victim must
    // repair that surviving out-of-scope blockedBy.
    writeIssue("p1", { kind: "project", title: "P1", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("e1", { kind: "epic", title: "E1", partOf: "p1", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("b1", { kind: "story", title: "B1", partOf: "e1", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("e-victim", { kind: "epic", title: "Victim", partOf: "p1", order: 1, createdAt: AT, updatedAt: AT });
    writeIssue("b2", { kind: "story", title: "B2", partOf: "e-victim", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("c2", {
      kind: "task",
      title: "C2",
      partOf: "b2",
      order: 0,
      status: "todo",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("b2s", {
      kind: "story",
      title: "B2 stacked",
      partOf: "e-victim",
      order: 1,
      stackedOn: "b2",
      createdAt: AT,
      updatedAt: AT,
    });
    writeFileSync(
      join(dir, "b2s", "comments.jsonl"),
      '{"role":"agent","body":"progress"}\n',
    );
    writeIssue("p2", { kind: "project", title: "P2", order: 1, createdAt: AT, updatedAt: AT });
    writeIssue("e-out", {
      kind: "epic",
      title: "Out",
      partOf: "p2",
      order: 0,
      blockedBy: ["e-victim"],
      createdAt: AT,
      updatedAt: AT,
    });

    const { apply, list } = await loadService();
    // Declare p1 with only e1 { b1 }; e-victim and its whole subtree (branch b2,
    // commit c2, stacked child b2s) are omitted → pruned.
    const doc: ApplyDoc = {
      project: {
        id: "p1",
        title: "P1",
        children: [
          {
            kind: "epic",
            id: "e1",
            title: "E1",
            children: [{ kind: "story", id: "b1", title: "B1" }],
          },
        ],
      },
    };
    const summary = await apply(doc);
    expect(summary.deleted.sort()).toEqual(["b2", "b2s", "c2", "e-victim"].sort());

    const result = list();
    expect(result.problems).toEqual([]);
    const ids = result.issues.map((i) => i.id).sort();
    expect(ids).not.toContain("e-victim");
    expect(ids).not.toContain("b2");
    expect(ids).not.toContain("c2");
    expect(ids).not.toContain("b2s");
    expect(ids).toContain("b1");

    // Pruning removes the node directories (comments.jsonl included), not just ids.
    expect(existsSync(join(dir, "e-victim"))).toBe(false);
    expect(existsSync(join(dir, "b2"))).toBe(false);
    expect(existsSync(join(dir, "c2"))).toBe(false);
    expect(existsSync(join(dir, "b2s"))).toBe(false);
    expect(existsSync(join(dir, "b2s", "comments.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "b1"))).toBe(true);

    // The surviving out-of-scope blocker edge into the pruned epic is dropped.
    const eOut = result.issues.find((i) => i.id === "e-out");
    expect(eOut && eOut.kind === "epic" ? eOut.blockedBy : ["unrepaired"]).toEqual(
      [],
    );
  });

  it("prunes an Idea omitted from project-root children:", async () => {
    writeIssue("p1", { kind: "project", title: "P1", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "p1",
      order: 1,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("e1", {
      kind: "epic",
      title: "E1",
      partOf: "p1",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    const { apply, list } = await loadService();
    const summary = await apply({
      project: {
        id: "p1",
        title: "P1",
        children: [{ kind: "epic", id: "e1", title: "E1 renamed" }],
      },
    });
    expect(summary.deleted).toEqual(["capture"]);
    expect(list().issues.map((issue) => issue.id).sort()).toEqual(["e1", "p1"]);
    expect(existsSync(join(dir, "capture"))).toBe(false);
    expect(readIssue("e1").title).toBe("E1 renamed");
  });
});
