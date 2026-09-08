import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import {
  AT,
  loadService,
  readIssue,
  useApplyTestFixtures,
  writeIssue,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — new root append (rooted subtree docs)", () => {
  it("appends a brand-new branch after the epic's existing root branches", async () => {
    // Project with an epic that already has one root branch at order 0.
    writeIssue("p1", { kind: "project", title: "P1", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("e1", { kind: "epic", title: "E1", partOf: "p1", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("base", { kind: "story", title: "Base", partOf: "e1", order: 0, createdAt: AT, updatedAt: AT });

    const { apply, list } = await loadService();
    const doc = {
      project: "p1",
      epic: "e1",
      story: { id: "newb", title: "New branch" },
    } as ApplyDoc;
    await apply(doc);

    expect(readIssue("newb").order).toBe(1);
    expect(readIssue("base").order).toBe(0);
    expect(list().problems).toEqual([]);
  });

  it("appends a brand-new project after existing projects", async () => {
    writeIssue("p-old", { kind: "project", title: "Old", order: 0, createdAt: AT, updatedAt: AT });

    const { apply, list } = await loadService();
    await apply({ project: { id: "p-new", title: "New" } } as ApplyDoc);

    expect(readIssue("p-new").order).toBe(1);
    expect(readIssue("p-old").order).toBe(0);
    expect(list().problems).toEqual([]);
  });
});
