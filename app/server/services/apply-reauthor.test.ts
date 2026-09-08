import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import {
  dir,
  loadService,
  readIssue,
  useApplyTestFixtures,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

// The declarative `apply` doc is the general mechanic for arbitrary structural
// reorganization: on every apply each node's `order` is (re)assigned from its
// position in its parent array, and `partOf`/`stackedOn` from nesting. So any
// move — insert-in-the-middle, relocate commits, split off a stacked branch,
// delete-and-relocate, restack — is expressed by re-authoring the tree, and the
// contiguous renumbering falls out for free. These pin that robustness.
describe("apply — arbitrary reorganization via re-authoring", () => {
  function commitsBranchDoc(commitIds: string[]): ApplyDoc {
    return {
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: [
              {
                kind: "story",
                id: "b",
                title: "B",
                children: commitIds.map((id) => ({ kind: "task" as const, id, title: id })),
              },
            ],
          },
        ],
      },
    };
  }

  it("inserts a new commit in the middle and renumbers the tail", async () => {
    const { apply, list } = await loadService();
    await apply(commitsBranchDoc(["c-a", "c-c"]));
    expect(readIssue("c-a").order).toBe(0);
    expect(readIssue("c-c").order).toBe(1);

    const summary = await apply(commitsBranchDoc(["c-a", "c-mid", "c-c"]));
    expect(summary.created).toEqual(["c-mid"]);
    expect(readIssue("c-a").order).toBe(0);
    expect(readIssue("c-mid").order).toBe(1);
    expect(readIssue("c-c").order).toBe(2);
    expect(list().problems).toEqual([]);
  });

  it("moves a commit from one branch to another, appending it in the destination", async () => {
    const { apply, list } = await loadService();
    const twoBranches = (b1: string[], b2: string[]): ApplyDoc => ({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: [
              {
                kind: "story",
                id: "b1",
                title: "B1",
                children: b1.map((id) => ({ kind: "task" as const, id, title: id })),
              },
              {
                kind: "story",
                id: "b2",
                title: "B2",
                children: b2.map((id) => ({ kind: "task" as const, id, title: id })),
              },
            ],
          },
        ],
      },
    });
    await apply(twoBranches(["x", "y"], ["z"]));

    // Re-author with `y` relocated under b2 after `z`.
    await apply(twoBranches(["x"], ["z", "y"]));

    expect(readIssue("y").partOf).toBe("b2");
    expect(readIssue("y").order).toBe(1);
    expect(readIssue("x").order).toBe(0);
    expect(readIssue("z").order).toBe(0);
    expect(list().problems).toEqual([]);
  });

  it("injects a new stacked branch that takes over the trailing commits", async () => {
    const { apply, list } = await loadService();
    await apply(commitsBranchDoc(["c1", "c2", "c3"]));

    // Split b: keep c1, move c2/c3 onto a brand-new branch stacked on b.
    const doc: ApplyDoc = {
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: [
              {
                kind: "story",
                id: "b",
                title: "B",
                children: [
                  { kind: "task", id: "c1", title: "c1" },
                  {
                    kind: "story",
                    id: "nb",
                    title: "New stacked",
                    children: [
                      { kind: "task", id: "c2", title: "c2" },
                      { kind: "task", id: "c3", title: "c3" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const summary = await apply(doc);

    expect(summary.created).toEqual(["nb"]);
    const nb = list().issues.find((i) => i.id === "nb");
    expect(nb?.kind === "story" ? nb.stackedOn : undefined).toBe("b");
    expect(readIssue("c1")).toMatchObject({ partOf: "b", order: 0 });
    expect(readIssue("c2")).toMatchObject({ partOf: "nb", order: 0 });
    expect(readIssue("c3")).toMatchObject({ partOf: "nb", order: 1 });
    expect(list().problems).toEqual([]);
  });

  it("deletes a branch while relocating its commits to a surviving branch", async () => {
    const { apply, list } = await loadService();
    const doc = (relocate: boolean): ApplyDoc => ({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: relocate
              ? [
                  {
                    kind: "story",
                    id: "bb",
                    title: "BB",
                    children: [
                      { kind: "task", id: "b1", title: "b1" },
                      { kind: "task", id: "a1", title: "a1" },
                    ],
                  },
                ]
              : [
                  {
                    kind: "story",
                    id: "ba",
                    title: "BA",
                    children: [{ kind: "task", id: "a1", title: "a1" }],
                  },
                  {
                    kind: "story",
                    id: "bb",
                    title: "BB",
                    children: [{ kind: "task", id: "b1", title: "b1" }],
                  },
                ],
          },
        ],
      },
    });
    await apply(doc(false));

    // Drop branch `ba` from the doc but keep its commit `a1` under `bb`: `ba` is
    // pruned, `a1` survives (it is still declared) and is reparented + appended.
    const summary = await apply(doc(true));
    expect(summary.deleted).toEqual(["ba"]);
    expect(existsSync(join(dir, "ba"))).toBe(false);
    expect(readIssue("a1")).toMatchObject({ partOf: "bb", order: 1 });
    expect(readIssue("b1")).toMatchObject({ partOf: "bb", order: 0 });
    expect(list().problems).toEqual([]);
  });

  it("re-parents a stacked branch onto a different fork point", async () => {
    const { apply, list } = await loadService();
    const doc = (featStackedOnBase2: boolean): ApplyDoc => ({
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: [
              {
                kind: "story",
                id: "base1",
                title: "Base1",
                ...(featStackedOnBase2
                  ? {}
                  : {
                      children: [{ kind: "story", id: "feat", title: "Feat" }],
                    }),
              },
              {
                kind: "story",
                id: "base2",
                title: "Base2",
                ...(featStackedOnBase2
                  ? {
                      children: [{ kind: "story", id: "feat", title: "Feat" }],
                    }
                  : {}),
              },
            ],
          },
        ],
      },
    });
    await apply(doc(false));
    expect(readIssue("feat").stackedOn).toBe("base1");

    await apply(doc(true));
    expect(readIssue("feat").stackedOn).toBe("base2");
    // First (and only) child of its new fork point → order 0, no collision.
    expect(readIssue("feat").order).toBe(0);
    expect(list().problems).toEqual([]);
  });
});
