import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import {
  baseDoc,
  dir,
  epicChildren,
  loadService,
  readIssue,
  useApplyTestFixtures,
} from "./apply.test-fixtures.js";

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

  it("does not persist mergeBase when applying a stacked child of a named parent", async () => {
    const { apply, update, list } = await loadService();
    await apply(baseDoc());
    await update("b1", { branchName: "feat/b1" });

    const doc = baseDoc();
    epicChildren(doc)[0].children![0].children!.push({
      kind: "story",
      id: "b1s2",
      title: "Second stacked child",
    });
    const summary = await apply(doc);
    expect(summary.created).toEqual(["b1s2"]);
    expect(readIssue("b1s2").mergeBase).toBeUndefined();
    expect(list().derived.b1s2?.mergeBase).toBe("feat/b1");
    expect(readIssue("b1s").mergeBase).toBeUndefined();
    expect(list().derived.b1s?.mergeBase).toBe("feat/b1");
  });

  it("derives mergeBase from a merged parent when applying a stacked child", async () => {
    const { apply, update, list } = await loadService();
    await apply(baseDoc());
    await update("b1", {
      branchName: "feat/b1",
      merged: true,
    });

    const doc = baseDoc();
    epicChildren(doc)[0].children![0].children!.push({
      kind: "story",
      id: "b1s2",
      title: "Child of merged parent",
    });
    const summary = await apply(doc);
    expect(summary.created).toEqual(["b1s2"]);
    expect(readIssue("b1s2").mergeBase).toBeUndefined();
    expect(list().derived.b1s2?.mergeBase).toBe("main");
  });

  it("re-derives mergeBase when apply restacks a story onto a different parent", async () => {
    const { apply, update, list } = await loadService();
    await apply(baseDoc());
    await update("b1", { branchName: "feat/b1" });
    await update("b2", { branchName: "feat/b2" });

    const doc = (stackOnB2: boolean): ApplyDoc => {
      const d = baseDoc();
      const stories = epicChildren(d)[0].children!;
      const b1 = stories[0];
      const b2 = stories[1];
      if (stackOnB2) {
        b1.children = [{ kind: "task", id: "c1", title: "Commit one" }];
        b2.children = [{ kind: "story", id: "b1s", title: "Stacked child" }];
      } else {
        b1.children = [
          { kind: "task", id: "c1", title: "Commit one" },
          { kind: "story", id: "b1s", title: "Stacked child" },
        ];
        b2.children = undefined;
      }
      return d;
    };

    await apply(doc(false));
    expect(readIssue("b1s").stackedOn).toBe("b1");
    expect(readIssue("b1s").mergeBase).toBeUndefined();
    expect(list().derived.b1s?.mergeBase).toBe("feat/b1");

    await apply(doc(true));
    expect(readIssue("b1s").stackedOn).toBe("b2");
    expect(readIssue("b1s").mergeBase).toBeUndefined();
    expect(list().derived.b1s?.mergeBase).toBe("feat/b2");
  });

  it("re-derives mergeBase when apply restacks onto a merged parent", async () => {
    const { apply, update, list } = await loadService();
    const initial = baseDoc();
    epicChildren(initial)[0].children![0].children = [{ kind: "task", id: "c1", title: "Commit one" }];
    epicChildren(initial)[0].children![1].children = [
      { kind: "story", id: "b1s", title: "Stacked child" },
    ];
    await apply(initial);
    await update("b1", {
      branchName: "feat/b1",
      merged: true,
    });
    await update("b2", { branchName: "feat/b2" });
    expect(list().derived.b1s?.mergeBase).toBe("feat/b2");

    const restacked = baseDoc();
    epicChildren(restacked)[0].children![0].children = [
      { kind: "task", id: "c1", title: "Commit one" },
      { kind: "story", id: "b1s", title: "Stacked child" },
    ];
    epicChildren(restacked)[0].children![1].children = undefined;

    await apply(restacked);
    expect(readIssue("b1s").stackedOn).toBe("b1");
    expect(readIssue("b1s").mergeBase).toBeUndefined();
    expect(list().derived.b1s?.mergeBase).toBe("main");
  });

  it("clears derived mergeBase when apply restacks onto an unnamed parent", async () => {
    const { apply, update, list } = await loadService();
    await apply(baseDoc());
    await update("b1", { branchName: "feat/b1" });

    const doc = baseDoc();
    epicChildren(doc)[0].children![0].children = [{ kind: "task", id: "c1", title: "Commit one" }];
    epicChildren(doc)[0].children![1].children = [
      { kind: "story", id: "b1s", title: "Stacked child" },
    ];

    await apply(doc);
    expect(readIssue("b1s").stackedOn).toBe("b2");
    expect(readIssue("b1s").mergeBase).toBeUndefined();
    expect(list().derived.b1s?.mergeBase).toBeUndefined();
  });

  it("does not persist mergeBase on re-apply when stackedOn is unchanged", async () => {
    const { apply, update, list } = await loadService();
    await apply(baseDoc());
    await update("b1", { branchName: "feat/b1" });

    const doc = baseDoc();
    epicChildren(doc)[0].children![0].title = "Branch one renamed";
    const summary = await apply(doc);
    expect(summary.updated).toContain("b1");
    expect(readIssue("b1s").stackedOn).toBe("b1");
    expect(readIssue("b1s").mergeBase).toBeUndefined();
    expect(list().derived.b1s?.mergeBase).toBe("feat/b1");
  });

  it("resolves a forward epic blockedBy reference to a sibling declared later", async () => {
    const { apply, list } = await loadService();
    // Sole focus: epic `early` blocks on epic `late`, which the doc declares
    // *after* it in the same project. apply must resolve the forward edge rather
    // than reject a reference to an as-yet-unseen node.
    const doc: ApplyDoc = {
      project: {
        id: "fp",
        title: "FP",
        children: [
          {
            kind: "epic",
            id: "early",
            title: "Early",
            blockedBy: ["late"],
          },
          { kind: "epic", id: "late", title: "Late" },
        ],
      },
    };
    await apply(doc);

    const result = list();
    expect(result.problems).toEqual([]);
    const early = result.issues.find((i) => i.id === "early");
    expect(
      early && early.kind === "epic" ? early.blockedBy : ["missing"],
    ).toEqual(["late"]);
  });
});
