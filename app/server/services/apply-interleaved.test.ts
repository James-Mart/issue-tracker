import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import {
  dir,
  loadService,
  readIssue,
  snapshot,
  useApplyTestFixtures,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — interleaved project children", () => {
  it("creates interleaved Epics and Ideas with shared order from children index", async () => {
    const { apply, list } = await loadService();
    const summary = await apply({
      project: {
        id: "p1",
        title: "P1",
        children: [
          { kind: "idea", id: "i1", title: "First idea", description: "Capture\n" },
          {
            kind: "epic",
            id: "e1",
            title: "Epic",
            children: [{ kind: "story", id: "b1", title: "B1" }],
          },
          { kind: "idea", id: "i2", title: "Second idea" },
        ],
      },
    });
    expect(summary.created.sort()).toEqual(["b1", "e1", "i1", "i2", "p1"].sort());
    expect(summary.deleted).toEqual([]);

    const result = list();
    expect(result.problems).toEqual([]);
    expect(readIssue("i1")).toMatchObject({
      kind: "idea",
      partOf: "p1",
      order: 0,
      title: "First idea",
    });
    expect(readFileSync(join(dir, "i1", "description.md"), "utf8")).toBe("Capture\n");
    expect(readIssue("e1")).toMatchObject({ kind: "epic", partOf: "p1", order: 1 });
    expect(readIssue("i2")).toMatchObject({ kind: "idea", partOf: "p1", order: 2 });
    expect(readIssue("b1")).toMatchObject({ kind: "story", partOf: "e1", order: 0 });
  });

  it("is idempotent for an interleaved children: doc", async () => {
    const { apply } = await loadService();
    const doc: ApplyDoc = {
      project: {
        id: "p1",
        title: "P1",
        children: [
          { kind: "epic", id: "e1", title: "E1" },
          { kind: "idea", id: "i1", title: "I1" },
        ],
      },
    };
    await apply(doc);
    const before = snapshot();
    const summary = await apply(doc);
    expect(summary).toEqual({ created: [], updated: [], deleted: [] });
    expect(snapshot()).toBe(before);
  });
});
