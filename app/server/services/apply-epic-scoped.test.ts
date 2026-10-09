import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import { AT, dir, loadService, useApplyTestFixtures, writeIssue } from "./apply.test-fixtures.js";

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
});
