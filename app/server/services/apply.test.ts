import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";


import {
  AT,
  baseDoc,
  dir,
  epicChildren,
  loadService,
  readIssue,
  snapshot,
  useApplyTestFixtures,
  writeIssue,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — idempotent re-apply", () => {
  it("is a no-op and does not churn updatedAt", async () => {
    const { apply } = await loadService();
    await apply(baseDoc());

    const before = new Map(
      ["proj", "epic-a", "b1", "b1s", "b2", "c1"].map((id) => [
        id,
        readIssue(id).updatedAt as string,
      ]),
    );
    const beforeBytes = snapshot();

    const summary = await apply(baseDoc());
    expect(summary).toEqual({ created: [], updated: [], deleted: [] });

    for (const [id, updatedAt] of before) {
      expect(readIssue(id).updatedAt).toBe(updatedAt);
    }
    // Beyond the updatedAt guard: a no-op re-apply must not rewrite any file,
    // including description.md, so the on-disk bytes are identical.
    expect(snapshot()).toBe(beforeBytes);
  });

  it("tidies a stale on-disk key the schema no longer recognizes", async () => {
    const { apply } = await loadService();
    await apply(baseDoc());

    // Simulate pre-migration drift: a Branch with a `blockedBy` key that the
    // current schema strips on read. The parsed issue is unchanged, so without
    // stale-key detection a re-apply would treat this file as a no-op.
    const path = join(dir, "b2", "issue.json");
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const updatedAt = raw.updatedAt as string;
    writeFileSync(path, JSON.stringify({ ...raw, blockedBy: ["b1"] }, null, 2));

    const otherBytes = snapshot();

    const summary = await apply(baseDoc());
    expect(summary.updated).toEqual(["b2"]);
    expect(summary.created).toEqual([]);
    expect(summary.deleted).toEqual([]);

    // The stale key is gone and every other on-disk field is preserved,
    // including `updatedAt` — tidying is not a semantic change.
    const after = readIssue("b2");
    expect("blockedBy" in after).toBe(false);
    expect(after.updatedAt).toBe(updatedAt);

    // Only b2 was rewritten; no sibling file changed.
    const before = JSON.parse(otherBytes) as Record<string, Record<string, string>>;
    const now = JSON.parse(snapshot()) as Record<string, Record<string, string>>;
    for (const id of Object.keys(before)) {
      if (id === "b2") continue;
      expect(now[id]).toEqual(before[id]);
    }
  });
});


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

describe("apply — Idea approvePlan", () => {
  it("preserves approvePlan when re-applying the Idea doc", async () => {
    const { apply, update } = await loadService();
    await apply({
      project: {
        id: "p1",
        title: "P1",
        children: [{ kind: "idea", id: "i1", title: "Capture" }],
      },
    });
    await update("i1", { approvePlan: true });
    expect(readIssue("i1").approvePlan).toBe(true);

    const summary = await apply({
      project: {
        id: "p1",
        title: "P1",
        children: [{ kind: "idea", id: "i1", title: "Capture renamed" }],
      },
    });
    expect(summary.updated).toContain("i1");
    expect(readIssue("i1")).toMatchObject({
      title: "Capture renamed",
      approvePlan: true,
    });
  });
});

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

describe("apply — atomic rejection", () => {
  it("makes no partial writes when the prospective graph is invalid", async () => {
    const { apply } = await loadService();
    await apply(baseDoc());

    const before = snapshot();

    // A new epic that blocks on a non-existent epic. Valid shape, but the whole
    // prospective set fails integrity, so nothing may be written.
    const doc = baseDoc();
    doc.project.children!.push({
      kind: "epic",
      id: "epic-c",
      title: "Epic C",
      blockedBy: ["ghost"],
      children: [{ kind: "story", id: "b3", title: "Branch three" }],
    });

    await expect(apply(doc)).rejects.toThrow(/unknown issue "ghost"/);

    expect(existsSync(join(dir, "epic-c"))).toBe(false);
    expect(existsSync(join(dir, "b3"))).toBe(false);
    expect(snapshot()).toBe(before);
  });

  it("rejects a create colliding with an id outside the declared project", async () => {
    // An orphan branch owned by a different project.
    writeIssue("p2", { kind: "project", title: "P2", createdAt: AT, updatedAt: AT });
    writeIssue("e2", { kind: "epic", title: "E2", partOf: "p2", createdAt: AT, updatedAt: AT });
    writeIssue("shared", {
      kind: "story",
      title: "Shared",
      partOf: "e2",
      createdAt: AT,
      updatedAt: AT,
    });

    const { apply, ensureMigrations } = await loadService();
    // One-time migrations run at the start of apply; settle them before the
    // "no writes on reject" snapshot so migration isn't mistaken for a
    // partial apply write.
    ensureMigrations();
    const before = snapshot();

    const doc: ApplyDoc = {
      project: {
        id: "p1",
        title: "P1",
        children: [
          {
            kind: "epic",
            id: "e1",
            title: "E1",
            children: [{ kind: "story", id: "shared", title: "Collision" }],
          },
        ],
      },
    };
    await expect(apply(doc)).rejects.toThrow(
      /already exists outside the target project/,
    );

    // The doc's project was never created, and the orphan is untouched.
    expect(existsSync(join(dir, "p1"))).toBe(false);
    expect(existsSync(join(dir, "e1"))).toBe(false);
    expect(snapshot()).toBe(before);
  });
});

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

describe("apply — branch-scoped doc", () => {
  // A stacked branch `feat` (forked off `base`) with one commit, plus `base` and
  // its own commit. Rooting the doc at `feat` reconciles only feat + its commits;
  // base and its commit are outside feat's subtree, and feat's fork point (which
  // a branch doc cannot express) must be preserved.
  function seedStack(): void {
    writeIssue("p1", { kind: "project", title: "P1", createdAt: AT, updatedAt: AT });
    writeIssue("e1", { kind: "epic", title: "E1", partOf: "p1", createdAt: AT, updatedAt: AT });
    writeIssue("base", { kind: "story", title: "Base", partOf: "e1", createdAt: AT, updatedAt: AT });
    writeIssue("base-c", {
      kind: "task",
      title: "Base commit",
      partOf: "base",
      status: "todo",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("feat", {
      kind: "story",
      title: "Feat",
      partOf: "e1",
      stackedOn: "base",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("feat-old", {
      kind: "task",
      title: "Old commit",
      partOf: "feat",
      status: "todo",
      createdAt: AT,
      updatedAt: AT,
    });
  }

  it("reconciles the branch's commit list, preserves the fork point, and leaves the rest", async () => {
    seedStack();
    const { apply, list } = await loadService();

    const doc = {
      project: "p1",
      epic: "e1",
      story: {
        id: "feat",
        title: "Feat",
        children: [{ kind: "task", id: "feat-new", title: "New commit" }],
      },
    } as ApplyDoc;
    const summary = await apply(doc);

    expect(summary.created).toEqual(["feat-new"]);
    expect(summary.deleted).toEqual(["feat-old"]);
    expect(existsSync(join(dir, "feat-old"))).toBe(false);

    const byId = new Map(list().issues.map((i) => [i.id, i]));
    // The fork point is preserved even though the branch doc never declared it.
    const feat = byId.get("feat");
    expect(feat?.kind === "story" ? feat.stackedOn : undefined).toBe("base");
    // base and its commit sit outside feat's subtree, so they are untouched.
    expect(byId.get("base")?.kind).toBe("story");
    expect(byId.get("base-c")?.kind).toBe("task");
    expect(list().problems).toEqual([]);
  });

  it("rejects when the epic is not in the referenced project", async () => {
    writeIssue("p1", { kind: "project", title: "P1", createdAt: AT, updatedAt: AT });
    writeIssue("p2", { kind: "project", title: "P2", createdAt: AT, updatedAt: AT });
    writeIssue("e1", { kind: "epic", title: "E1", partOf: "p2", createdAt: AT, updatedAt: AT });
    const { apply } = await loadService();

    const doc = {
      project: "p1",
      epic: "e1",
      story: { id: "b", title: "B" },
    } as ApplyDoc;
    await expect(apply(doc)).rejects.toThrow(/already belongs to "p2"/);
  });

  it("rejects when the branch already belongs to a different epic", async () => {
    writeIssue("p1", { kind: "project", title: "P1", createdAt: AT, updatedAt: AT });
    writeIssue("e1", { kind: "epic", title: "E1", partOf: "p1", createdAt: AT, updatedAt: AT });
    writeIssue("e-other", { kind: "epic", title: "Other", partOf: "p1", createdAt: AT, updatedAt: AT });
    writeIssue("feat", { kind: "story", title: "Feat", partOf: "e-other", createdAt: AT, updatedAt: AT });
    const { apply } = await loadService();

    const doc = {
      project: "p1",
      epic: "e1",
      story: { id: "feat", title: "Feat" },
    } as ApplyDoc;
    await expect(apply(doc)).rejects.toThrow(/already belongs to "e-other"/);
  });
});


describe("apply — sibling order", () => {
  it("infers order from doc position and re-authoring reorders commits", async () => {
    const { apply } = await loadService();
    const doc: ApplyDoc = {
      project: {
        id: "ord",
        title: "Order",
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
                  { kind: "task", id: "first", title: "First" },
                  { kind: "task", id: "second", title: "Second" },
                ],
              },
            ],
          },
        ],
      },
    };
    await apply(doc);
    expect(readIssue("first").order).toBe(0);
    expect(readIssue("second").order).toBe(1);

    epicChildren(doc)[0].children![0].children = [
      { kind: "task", id: "second", title: "Second" },
      { kind: "task", id: "first", title: "First" },
    ];
    await apply(doc);
    expect(readIssue("first").order).toBe(1);
    expect(readIssue("second").order).toBe(0);
  });

  it("rejects a doc with explicit order and writes nothing", async () => {
    await loadService();
    const before = snapshot();
    const { parseApplyDoc } = await import("./apply-schema.js");
    const { parse } = await import("yaml");
    const parsed = parseApplyDoc(
      parse(`
project:
  id: bad
  title: Bad
  children:
    - kind: epic
      id: e
      title: E
      children:
        - kind: story
          id: b
          title: B
          children:
            - kind: task
              id: c1
              title: C1
              order: 0
            - kind: task
              id: c2
              title: C2
              order: 0
`),
    );
    expect(parsed.ok).toBe(false);
    expect(snapshot()).toBe(before);
  });
});

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
