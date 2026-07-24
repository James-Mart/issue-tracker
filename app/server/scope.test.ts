import { describe, expect, it } from "vitest";
import {
  assertScopeVisible,
  resolveBoardScope,
  scopeIssueIds,
} from "./scope";
import type { IssueRecord } from "./schemas";

const AT = "2026-07-10T14:00:00.000Z";

const record = (
  id: string,
  kind: IssueRecord["kind"],
  extras: Record<string, unknown> = {},
): IssueRecord =>
  ({
    id,
    kind,
    title: id,
    createdAt: AT,
    updatedAt: AT,
    ...(kind === "project" ? {} : { partOf: "p" }),
    ...(kind === "epic" ? { blockedBy: [] } : {}),
    ...(kind === "story" ? { merged: false } : {}),
    ...(kind === "task" ? { status: "todo" } : {}),
    ...extras,
  }) as unknown as IssueRecord;

const fixture = (): IssueRecord[] => [
  record("p", "project"),
  record("e", "epic"),
  record("a", "story", { partOf: "e" }),
  record("c1", "task", { partOf: "a" }),
  record("idea-1", "idea"),
];

describe("resolveBoardScope", () => {
  it("returns all when id is omitted", () => {
    expect(resolveBoardScope(undefined, fixture(), "tree")).toEqual({ kind: "all" });
  });

  it("scopes project/epic/story by id", () => {
    const issues = fixture();
    expect(resolveBoardScope("p", issues, "tree")).toEqual({
      kind: "project",
      projectId: "p",
    });
    expect(resolveBoardScope("e", issues, "list")).toEqual({
      kind: "epic",
      epicId: "e",
    });
    const story = resolveBoardScope("a", issues, "tree");
    expect(story.kind).toBe("story");
    if (story.kind === "story") expect(story.story.id).toBe("a");
  });

  it("refuses idea and task with verb-specific errors", () => {
    const issues = fixture();
    expect(() => resolveBoardScope("idea-1", issues, "tree")).toThrow(
      /cannot scope tree to an idea/,
    );
    expect(() => resolveBoardScope("c1", issues, "list")).toThrow(
      /cannot scope list to a task.*story "a"/,
    );
  });

  it("throws on unknown id", () => {
    expect(() => resolveBoardScope("ghost", fixture(), "tree")).toThrow(
      /unknown issue "ghost"/,
    );
  });
});

describe("scopeIssueIds", () => {
  it("returns all ids for all-scope", () => {
    const issues = fixture();
    expect([...scopeIssueIds({ kind: "all" }, issues)].sort()).toEqual(
      ["a", "c1", "e", "idea-1", "p"],
    );
  });

  it("returns subtree ids for project/epic/story", () => {
    const issues = fixture();
    expect([...scopeIssueIds({ kind: "project", projectId: "p" }, issues)].sort()).toEqual(
      ["a", "c1", "e", "idea-1", "p"],
    );
    expect([...scopeIssueIds({ kind: "epic", epicId: "e" }, issues)].sort()).toEqual(
      ["a", "c1", "e"],
    );
    const story = issues.find((i) => i.id === "a") as Extract<IssueRecord, { kind: "story" }>;
    expect([...scopeIssueIds({ kind: "story", story }, issues)].sort()).toEqual(
      ["a", "c1"],
    );
  });
});

describe("assertScopeVisible", () => {
  it("passes when epic/story ids are visible", () => {
    expect(() =>
      assertScopeVisible({ kind: "epic", epicId: "e" }, new Set(["e"])),
    ).not.toThrow();
    const story = fixture().find((i) => i.id === "a") as Extract<
      IssueRecord,
      { kind: "story" }
    >;
    expect(() =>
      assertScopeVisible({ kind: "story", story }, new Set(["a"])),
    ).not.toThrow();
  });

  it("throws when epic or story is not visible", () => {
    expect(() =>
      assertScopeVisible({ kind: "epic", epicId: "e" }, new Set()),
    ).toThrow(/epic "e" is archived; pass --show-archived/);
    const story = fixture().find((i) => i.id === "a") as Extract<
      IssueRecord,
      { kind: "story" }
    >;
    expect(() =>
      assertScopeVisible({ kind: "story", story }, new Set()),
    ).toThrow(/story "a" is archived; pass --show-archived/);
  });
});
