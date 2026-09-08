import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import {
  AT,
  dir,
  loadService,
  readIssue,
  snapshot,
  useApplyTestFixtures,
  writeIssue,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — epic-scoped doc", () => {
  // p1 has two epics: e1 (b1 kept + b-old to prune) and e2 (b2). Rooting the doc
  // at e1 must prune only within e1 and leave e2, b2, and the project alone.
  function seedTwoEpicProject(): void {
    writeIssue("p1", { kind: "project", title: "P1", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("e1", { kind: "epic", title: "E1", partOf: "p1", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("b1", { kind: "story", title: "B1", partOf: "e1", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("b-old", { kind: "story", title: "Old", partOf: "e1", order: 1, createdAt: AT, updatedAt: AT });
    writeIssue("e2", { kind: "epic", title: "E2", partOf: "p1", order: 1, createdAt: AT, updatedAt: AT });
    writeIssue("b2", { kind: "story", title: "B2", partOf: "e2", order: 0, createdAt: AT, updatedAt: AT });
  }

  it("prunes within the target epic only and leaves siblings + project untouched", async () => {
    seedTwoEpicProject();
    const { apply, list } = await loadService();

    const doc = {
      project: "p1",
      epic: { id: "e1", title: "E1", children: [{ kind: "story", id: "b1", title: "B1" }] },
    } as ApplyDoc;
    const summary = await apply(doc);

    expect(summary.deleted).toEqual(["b-old"]);
    expect(existsSync(join(dir, "b-old"))).toBe(false);
    // Everything outside e1's subtree survives unchanged.
    expect(list().issues.map((i) => i.id).sort()).toEqual(
      ["b1", "b2", "e1", "e2", "p1"].sort(),
    );
  });

  it("does not delete Ideas under the project", async () => {
    seedTwoEpicProject();
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "p1",
      order: 2,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    const { apply, list } = await loadService();

    const summary = await apply({
      project: "p1",
      epic: { id: "e1", title: "E1", children: [{ kind: "story", id: "b1", title: "B1" }] },
    } as ApplyDoc);

    expect(summary.deleted).toEqual(["b-old"]);
    expect(list().issues.map((i) => i.id).sort()).toEqual(
      ["b1", "b2", "capture", "e1", "e2", "p1"].sort(),
    );
    expect(readIssue("capture").title).toBe("Capture");
  });

  it("appends a brand-new epic after existing siblings instead of colliding at 0", async () => {
    // Two epics already exist at order 0 and 1. A new epic-rooted doc for a third
    // epic must append (order 2), not default to 0 and collide with e1.
    seedTwoEpicProject();
    const { apply } = await loadService();

    const doc = {
      project: "p1",
      epic: { id: "e3", title: "E3" },
    } as ApplyDoc;
    await apply(doc);

    expect(readIssue("e3").order).toBe(2);
    // Existing siblings keep their orders; no duplicate-order integrity problem.
    expect(readIssue("e1").order).toBe(0);
    expect(readIssue("e2").order).toBe(1);
  });

  it("rejects when the referenced project does not exist", async () => {
    const { apply } = await loadService();
    const doc = { project: "ghost", epic: { id: "e1", title: "E1" } } as ApplyDoc;
    await expect(apply(doc)).rejects.toThrow(/project "ghost" does not exist/);
  });

  it("rejects when the epic already belongs to a different project", async () => {
    writeIssue("p1", { kind: "project", title: "P1", createdAt: AT, updatedAt: AT });
    writeIssue("p2", { kind: "project", title: "P2", createdAt: AT, updatedAt: AT });
    writeIssue("e1", { kind: "epic", title: "E1", partOf: "p2", createdAt: AT, updatedAt: AT });
    const { apply, ensureMigrations } = await loadService();
    ensureMigrations();
    const before = snapshot();

    const doc = { project: "p1", epic: { id: "e1", title: "E1" } } as ApplyDoc;
    await expect(apply(doc)).rejects.toThrow(/already belongs to "p2"/);
    expect(snapshot()).toBe(before);
  });
});
