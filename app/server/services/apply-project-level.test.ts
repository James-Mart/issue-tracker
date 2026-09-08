import { existsSync, writeFileSync } from "fs";
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

  it("prunes a project-level story omitted from children:", async () => {
    writeIssue("p1", { kind: "project", title: "P1", createdAt: AT, updatedAt: AT });
    writeIssue("solo", {
      kind: "story",
      title: "Solo",
      partOf: "p1",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("e1", {
      kind: "epic",
      title: "E1",
      partOf: "p1",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    const { apply, list } = await loadService();
    const summary = await apply({
      project: {
        id: "p1",
        title: "P1",
        children: [{ kind: "epic", id: "e1", title: "E1" }],
      },
    });
    expect(summary.deleted).toEqual(["solo"]);
    expect(list().issues.map((i) => i.id).sort()).toEqual(["e1", "p1"]);
  });

  it("story form without epic: reconciles a project-level story and preserves stackedOn", async () => {
    writeIssue("p1", { kind: "project", title: "P1", createdAt: AT, updatedAt: AT });
    writeIssue("base", {
      kind: "story",
      title: "Base",
      partOf: "p1",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("feat", {
      kind: "story",
      title: "Feat",
      partOf: "p1",
      order: 1,
      stackedOn: "base",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("feat-old", {
      kind: "task",
      title: "Old",
      partOf: "feat",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const { apply, list } = await loadService();

    const summary = await apply({
      project: "p1",
      story: {
        id: "feat",
        title: "Feat",
        children: [{ kind: "task", id: "feat-new", title: "New" }],
      },
    });
    expect(summary.created).toEqual(["feat-new"]);
    expect(summary.deleted).toEqual(["feat-old"]);
    expect(readIssue("feat")).toMatchObject({
      kind: "story",
      partOf: "p1",
      stackedOn: "base",
    });
    expect(readIssue("base").kind).toBe("story");
    expect(list().problems).toEqual([]);
  });

  it("story form without epic: refuses when the story's partOf is an Epic", async () => {
    writeIssue("p1", { kind: "project", title: "P1", createdAt: AT, updatedAt: AT });
    writeIssue("e1", {
      kind: "epic",
      title: "E1",
      partOf: "p1",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("feat", {
      kind: "story",
      title: "Feat",
      partOf: "e1",
      createdAt: AT,
      updatedAt: AT,
    });
    const { apply, ensureMigrations } = await loadService();
    ensureMigrations();
    const before = snapshot();

    await expect(
      apply({
        project: "p1",
        story: { id: "feat", title: "Feat" },
      }),
    ).rejects.toThrow(/belongs to epic "e1".*epic-scoped story form/);
    expect(snapshot()).toBe(before);
  });

  it("creates a new project-level story via story form without epic:", async () => {
    writeIssue("p1", { kind: "project", title: "P1", createdAt: AT, updatedAt: AT });
    const { apply, list } = await loadService();
    const summary = await apply({
      project: "p1",
      story: {
        id: "solo",
        title: "Solo",
        children: [{ kind: "task", id: "t1", title: "T1" }],
      },
    });
    expect(summary.created.sort()).toEqual(["solo", "t1"].sort());
    expect(readIssue("solo")).toMatchObject({
      kind: "story",
      partOf: "p1",
    });
    expect(list().problems).toEqual([]);
  });
});
