import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { baseDoc, dir, loadService, useApplyTestFixtures } from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — create from empty", () => {
  it("creates the whole declared tree with inferred relationships", async () => {
    const { apply, list } = await loadService();
    const summary = await apply(baseDoc());

    expect(summary.created.sort()).toEqual(
      ["b1", "b1s", "b2", "c1", "epic-a", "epic-b", "proj"].sort(),
    );
    expect(summary.updated).toEqual([]);
    expect(summary.deleted).toEqual([]);

    const result = list();
    expect(result.problems).toEqual([]);
    const byId = new Map(result.issues.map((i) => [i.id, i]));

    expect(byId.get("proj")?.kind).toBe("project");
    const epic = byId.get("epic-a");
    expect(epic?.kind).toBe("epic");
    expect(epic && "partOf" in epic && epic.partOf).toBe("proj");
    expect(epic && epic.kind === "epic" ? epic.blockedBy : []).toEqual(["epic-b"]);

    const b1 = byId.get("b1");
    if (b1?.kind !== "story") throw new Error("b1 missing");
    expect(b1.partOf).toBe("epic-a");
    expect(b1.stackedOn).toBeUndefined();
    expect("mergeBase" in b1).toBe(false);
    expect(result.derived.b1?.mergeBase).toBe("main");

    const b1s = byId.get("b1s");
    if (b1s?.kind !== "story") throw new Error("b1s missing");
    expect(b1s.partOf).toBe("epic-a");
    expect(b1s.stackedOn).toBe("b1");
    // Parent has no branchName yet — derived mergeBase unset.
    expect(result.derived.b1s?.mergeBase).toBeUndefined();

    const b2 = byId.get("b2");
    if (b2?.kind !== "story") throw new Error("b2 missing");
    expect(b2.partOf).toBe("epic-a");
    expect(b2.stackedOn).toBeUndefined();
    expect(result.derived.b2?.mergeBase).toBe("main");

    const c1 = byId.get("c1");
    if (c1?.kind !== "task") throw new Error("c1 missing");
    expect(c1.partOf).toBe("b1");
    expect(c1.status).toBe("todo");

    // Every node got a description.md (author-supplied or the default heading).
    expect(readFileSync(join(dir, "proj", "description.md"), "utf8")).toBe(
      "Project overview\n",
    );
  });
});
