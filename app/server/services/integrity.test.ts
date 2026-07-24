import { describe, expect, it } from "vitest";
import { checkIntegrity, problemsFor } from "./integrity";
import type { Issue } from "../schemas";

const AT = "2026-07-09T14:00:00.000Z";

const project = (id: string): Issue => ({
  id,
  kind: "project",
  title: id,
  order: 0,
  createdAt: AT,
  updatedAt: AT,
});

const epic = (
  id: string,
  partOf = "root",
  extra: Partial<Extract<Issue, { kind: "epic" }>> = {},
): Issue => ({
  id,
  kind: "epic",
  title: id,
  partOf,
  order: 0,
  blockedBy: [],
  needsAttention: false,
  attentionReason: null,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const idea = (
  id: string,
  partOf = "root",
  extra: Partial<Extract<Issue, { kind: "idea" }>> = {},
): Issue => ({
  id,
  kind: "idea",
  title: id,
  partOf,
  order: 0,
  archived: false,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const branch = (
  id: string,
  partOf: string,
  extra: Partial<Extract<Issue, { kind: "story" }>> = {},
): Issue => ({
  id,
  kind: "story",
  title: id,
  partOf,
  order: 0,
  merged: false,
  needsAttention: false,
  attentionReason: null,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const commit = (id: string, partOf: string, order = 0): Issue => ({
  id,
  kind: "task",
  title: id,
  partOf,
  order,
  status: "todo",
  needsAttention: false,
  attentionReason: null,
  createdAt: AT,
  updatedAt: AT,
});

describe("checkIntegrity", () => {
  it("passes a well-formed tree", () => {
    const issues = [
      project("root"),
      epic("e1"),
      epic("e2", "root", { order: 1, blockedBy: ["e1"] }),
      branch("b1", "e1"),
      branch("b2", "e1", { stackedOn: "b1" }),
      commit("c1", "b1"),
    ];
    expect(checkIntegrity(issues)).toEqual([]);
  });

  it("flags an epic whose partOf is not a project", () => {
    const problems = checkIntegrity([epic("e1", "b1"), branch("b1", "e1")]);
    expect(
      problems.some((p) => p.id === "e1" && p.message.includes("must be a project")),
    ).toBe(true);
  });

  it("flags a dangling partOf", () => {
    const problems = checkIntegrity([commit("c1", "ghost")]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ id: "c1" });
    expect(problems[0].message).toContain("unknown issue");
  });

  it("flags a commit whose partOf is not a story", () => {
    const problems = checkIntegrity([project("root"), epic("e1"), commit("c1", "e1")]);
    expect(problems.some((p) => p.message.includes("must be a story"))).toBe(true);
  });

  it("flags a story whose partOf is not a project or epic", () => {
    const problems = checkIntegrity([
      project("root"),
      branch("b1", "root"),
      branch("b2", "b1"),
    ]);
    const relevant = problems.filter((p) => p.id === "b2");
    expect(relevant[0].message).toMatch(/must be one of: project, epic/);
  });

  it("accepts a story partOf a project or an epic", () => {
    const problems = checkIntegrity([
      project("root"),
      epic("e1"),
      branch("project-story", "root", { order: 1 }),
      branch("epic-story", "e1"),
      commit("c1", "project-story"),
    ]);
    expect(problems).toEqual([]);
  });

  it("rejects a story partOf a task or idea", () => {
    const problems = checkIntegrity([
      project("root"),
      idea("i1"),
      branch("under-idea", "i1"),
      branch("ok", "root", { order: 1 }),
      commit("c1", "ok"),
      branch("under-task", "c1"),
    ]);
    expect(
      problems.some(
        (p) =>
          p.id === "under-idea" &&
          p.message.includes("must be one of: project, epic"),
      ),
    ).toBe(true);
    expect(
      problems.some(
        (p) =>
          p.id === "under-task" &&
          p.message.includes("must be one of: project, epic"),
      ),
    ).toBe(true);
  });

  it("flags a dangling stackedOn", () => {
    const problems = checkIntegrity([
      epic("e1"),
      branch("b1", "e1", { stackedOn: "ghost" }),
    ]);
    expect(problems.some((p) => p.message.includes("stackedOn"))).toBe(true);
  });

  it("flags a stackedOn that is not a story", () => {
    const problems = checkIntegrity([
      epic("e1"),
      branch("b1", "e1", { stackedOn: "e1" }),
    ]);
    expect(
      problems.some(
        (p) => p.message.includes("stackedOn") && p.message.includes("story"),
      ),
    ).toBe(true);
  });

  it("flags a stackedOn in a different epic", () => {
    const problems = checkIntegrity([
      epic("e1"),
      epic("e2"),
      branch("b1", "e1"),
      branch("b2", "e2", { stackedOn: "b1" }),
    ]);
    expect(
      problems.some(
        (p) => p.id === "b2" && p.message.includes("same Epic"),
      ),
    ).toBe(true);
  });

  it("flags a stackedOn across different projects for project-level stories", () => {
    const problems = checkIntegrity([
      project("p1"),
      project("p2"),
      branch("b1", "p1"),
      branch("b2", "p2", { stackedOn: "b1" }),
    ]);
    expect(
      problems.some(
        (p) => p.id === "b2" && p.message.includes("same Project"),
      ),
    ).toBe(true);
  });

  it("does not flag a same-epic stackedOn", () => {
    const problems = checkIntegrity([
      epic("e1"),
      branch("b1", "e1"),
      branch("b2", "e1", { stackedOn: "b1" }),
    ]);
    expect(problems.some((p) => p.message.includes("same Epic"))).toBe(false);
  });

  it("does not flag a same-project stackedOn for project-level stories", () => {
    const problems = checkIntegrity([
      project("root"),
      branch("b1", "root"),
      branch("b2", "root", { order: 1, stackedOn: "b1" }),
    ]);
    expect(problems.some((p) => p.message.includes("same Project"))).toBe(
      false,
    );
  });

  it("flags a dangling blockedBy referent", () => {
    const problems = checkIntegrity([
      project("root"),
      epic("e1", "root", { blockedBy: ["ghost"] }),
    ]);
    expect(problems.some((p) => p.message.includes("blockedBy"))).toBe(true);
  });

  it("flags a blockedBy referent that is not an epic", () => {
    const problems = checkIntegrity([
      project("root"),
      epic("e1", "root", { blockedBy: ["b1"] }),
      epic("e2", "root", { order: 1 }),
      branch("b1", "e2"),
    ]);
    expect(
      problems.some(
        (p) => p.id === "e1" && p.message.includes("blockedBy") && p.message.includes("epic"),
      ),
    ).toBe(true);
  });

  it("flags a blockedBy epic in a different project", () => {
    const problems = checkIntegrity([
      project("p1"),
      project("p2"),
      epic("e1", "p1", { blockedBy: ["e2"] }),
      epic("e2", "p2"),
    ]);
    expect(
      problems.some(
        (p) => p.id === "e1" && p.message.includes("same Project"),
      ),
    ).toBe(true);
  });

  it("does not flag a same-project blockedBy", () => {
    const problems = checkIntegrity([
      project("root"),
      epic("e1", "root", { blockedBy: ["e2"] }),
      epic("e2", "root", { order: 1 }),
    ]);
    expect(problems.some((p) => p.message.includes("blockedBy"))).toBe(false);
  });

  it("flags duplicate order within a sibling group", () => {
    const problems = checkIntegrity([
      project("root"),
      epic("e1"),
      epic("e2", "root", { order: 0 }),
    ]);
    expect(
      problems.some((p) => p.id === "e2" && p.message.includes("duplicate order")),
    ).toBe(true);
  });

  it("flags duplicate order between an epic and an idea in the same project", () => {
    const problems = checkIntegrity([
      project("root"),
      epic("e1"),
      idea("i1", "root", { order: 0 }),
    ]);
    expect(
      problems.some((p) => p.message.includes("duplicate order")),
    ).toBe(true);
  });

  it("flags an idea whose partOf is not a project", () => {
    const problems = checkIntegrity([
      project("root"),
      epic("e1"),
      idea("i1", "e1"),
    ]);
    expect(
      problems.some(
        (p) => p.id === "i1" && p.message.includes("must be a project"),
      ),
    ).toBe(true);
  });
});

describe("checkIntegrity - cycles", () => {
  it("flags a branch stacked on itself", () => {
    const problems = checkIntegrity([
      epic("e1"),
      branch("b1", "e1", { stackedOn: "b1" }),
    ]);
    expect(problems.some((p) => p.id === "b1" && /cycle/i.test(p.message))).toBe(
      true,
    );
  });

  it("flags a two-branch stackedOn cycle on both members", () => {
    const problems = checkIntegrity([
      epic("e1"),
      branch("a", "e1", { stackedOn: "b" }),
      branch("b", "e1", { stackedOn: "a" }),
    ]);
    const cycleIds = problems
      .filter((p) => /cycle/i.test(p.message))
      .map((p) => p.id)
      .sort();
    expect(cycleIds).toEqual(["a", "b"]);
  });

  it("flags an epic-level blockedBy cycle on both members", () => {
    const problems = checkIntegrity([
      project("root"),
      epic("e1", "root", { blockedBy: ["e2"] }),
      epic("e2", "root", { order: 1, blockedBy: ["e1"] }),
    ]);
    const cycleIds = problems
      .filter((p) => /cycle/i.test(p.message))
      .map((p) => p.id)
      .sort();
    expect(cycleIds).toEqual(["e1", "e2"]);
  });

  it("flags a three-epic blockedBy cycle", () => {
    const problems = checkIntegrity([
      project("root"),
      epic("a", "root", { order: 0, blockedBy: ["b"] }),
      epic("b", "root", { order: 1, blockedBy: ["c"] }),
      epic("c", "root", { order: 2, blockedBy: ["a"] }),
    ]);
    const cycleIds = problems
      .filter((p) => /cycle/i.test(p.message))
      .map((p) => p.id)
      .sort();
    expect(cycleIds).toEqual(["a", "b", "c"]);
  });

  it("does not flag a well-formed dependency chain", () => {
    const problems = checkIntegrity([
      project("root"),
      epic("e1", "root", { blockedBy: ["e2"] }),
      epic("e2", "root", { order: 1 }),
      branch("a", "e1"),
      branch("b", "e1", { stackedOn: "a" }),
      branch("c", "e1", { stackedOn: "b" }),
    ]);
    expect(problems.filter((p) => /cycle/i.test(p.message))).toEqual([]);
  });
});

describe("closed-catalog label assignments", () => {
  it("accepts assignments that exist in the Project catalog", () => {
    const issues = [
      {
        ...project("root"),
        labels: [{ id: "bug", color: "#ff0000" }],
      },
      epic("e1", "root", { labels: ["bug"] }),
      idea("i1", "root", { order: 1, labels: ["bug"] }),
      branch("b1", "e1", { labels: ["bug"] }),
    ];
    expect(checkIntegrity(issues)).toEqual([]);
  });

  it("flags an assignment id absent from the Project catalog", () => {
    const issues = [
      {
        ...project("root"),
        labels: [{ id: "bug", color: "#ff0000" }],
      },
      epic("e1", "root", { labels: ["ghost"] }),
    ];
    const problems = checkIntegrity(issues);
    expect(
      problems.some(
        (p) =>
          p.id === "e1" &&
          p.message.includes('unknown catalog id "ghost"'),
      ),
    ).toBe(true);
  });

  it("flags story assignments against an empty catalog", () => {
    const issues = [
      project("root"),
      epic("e1"),
      branch("b1", "e1", { labels: ["bug"] }),
    ];
    const problems = checkIntegrity(issues);
    expect(
      problems.some(
        (p) =>
          p.id === "b1" &&
          p.message.includes('unknown catalog id "bug"'),
      ),
    ).toBe(true);
  });
});

describe("problemsFor", () => {
  it("returns only problems attributed to the given id", () => {
    const issues = [commit("c1", "ghost"), commit("c2", "ghost2")];
    const only = problemsFor("c1", issues);
    expect(only).toHaveLength(1);
    expect(only[0].id).toBe("c1");
  });
});

describe("validate-at-write (problemsFor against a prospective state)", () => {
  it("rejects a write that would close a stackedOn cycle", () => {
    const prospective = [
      epic("e1"),
      branch("a", "e1", { stackedOn: "b" }),
      branch("b", "e1", { stackedOn: "a" }),
    ];
    expect(problemsFor("b", prospective).length).toBeGreaterThan(0);
  });

  it("rejects a write with a dangling blockedBy", () => {
    const prospective = [
      project("root"),
      epic("e1", "root", { blockedBy: ["ghost"] }),
    ];
    expect(problemsFor("e1", prospective)[0].message).toContain("unknown issue");
  });

  it("rejects a write with a kind violation", () => {
    const prospective = [epic("e1"), commit("c", "e1")];
    expect(problemsFor("c", prospective)[0].message).toContain("must be a story");
  });

  it("accepts a valid write", () => {
    const prospective = [
      epic("e1"),
      branch("a", "e1"),
      branch("b", "e1", { stackedOn: "a" }),
    ];
    expect(problemsFor("b", prospective)).toEqual([]);
  });
});
