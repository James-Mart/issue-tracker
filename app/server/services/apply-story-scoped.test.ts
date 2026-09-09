import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import {
  AT,
  dir,
  loadService,
  readIssue,
  useApplyTestFixtures,
  writeIssue,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

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

  it("preserves a task sourceIdea across a story-scoped re-apply", async () => {
    writeIssue("p1", { kind: "project", title: "P1", createdAt: AT, updatedAt: AT });
    writeIssue("idea-a", {
      kind: "idea",
      title: "Capture",
      partOf: "p1",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("e1", { kind: "epic", title: "E1", partOf: "p1", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("story", { kind: "story", title: "Story", partOf: "e1", createdAt: AT, updatedAt: AT });
    writeIssue("task-a", {
      kind: "task",
      title: "Task A",
      partOf: "story",
      status: "todo",
      sourceIdea: "idea-a",
      createdAt: AT,
      updatedAt: AT,
    });

    const { apply } = await loadService();
    const doc = {
      project: "p1",
      epic: "e1",
      story: {
        id: "story",
        title: "Story renamed",
        children: [{ kind: "task", id: "task-a", title: "Task A renamed" }],
      },
    } as ApplyDoc;
    const summary = await apply(doc);

    expect(summary.updated).toEqual(["story", "task-a"]);
    const task = readIssue("task-a");
    expect(task.title).toBe("Task A renamed");
    expect(task.sourceIdea).toBe("idea-a");
  });
});
