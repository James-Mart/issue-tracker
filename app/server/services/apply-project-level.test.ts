import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import { dir, loadService, readIssue, useApplyTestFixtures } from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — project-level stories", () => {
  it("creates, updates, and prunes kind: story project children with stacking", async () => {
    const { apply, list } = await loadService();
    const doc: ApplyDoc = {
      project: {
        id: "p1",
        title: "P1",
        children: [
          {
            kind: "story",
            id: "solo",
            title: "Solo",
            children: [
              { kind: "task", id: "t1", title: "Task 1" },
              { kind: "story", id: "solo-s", title: "Stacked" },
            ],
          },
          { kind: "idea", id: "i1", title: "Idea" },
        ],
      },
    };
    const created = await apply(doc);
    expect(created.created.sort()).toEqual(
      ["i1", "p1", "solo", "solo-s", "t1"].sort(),
    );
    expect(readIssue("solo")).toMatchObject({
      kind: "story",
      partOf: "p1",
      order: 0,
    });
    expect(readIssue("solo-s")).toMatchObject({
      kind: "story",
      partOf: "p1",
      stackedOn: "solo",
      order: 0,
    });
    expect(readIssue("t1")).toMatchObject({ kind: "task", partOf: "solo", order: 0 });
    expect(list().problems).toEqual([]);

    // Update title + prune omitted stacked child; add a new task.
    const summary = await apply({
      project: {
        id: "p1",
        title: "P1",
        children: [
          {
            kind: "story",
            id: "solo",
            title: "Solo renamed",
            children: [
              { kind: "task", id: "t1", title: "Task 1" },
              { kind: "task", id: "t2", title: "Task 2" },
            ],
          },
          { kind: "idea", id: "i1", title: "Idea" },
        ],
      },
    });
    expect(summary.created).toEqual(["t2"]);
    expect(summary.deleted).toEqual(["solo-s"]);
    expect(readIssue("solo").title).toBe("Solo renamed");
    expect(existsSync(join(dir, "solo-s"))).toBe(false);
    expect(list().problems).toEqual([]);
  });
});
