import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { leafTaskProgressCount, leafTasksOf } from "./derived";
import { buildTreeRowIndexes } from "./tree-row-indexes";

const timestamps = {
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

function task(
  id: string,
  partOf: string,
  status: "todo" | "done" | "in-progress",
): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    status,
    commits: [],
    order: 0,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...timestamps,
  };
}

function story(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: 0,
    branchName: id,
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...timestamps,
  };
}

function epic(id: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "p",
    order: 0,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    blockedBy: [],
    ...timestamps,
  };
}

function counted(issue: IssueRecord, issues: IssueRecord[]): string | undefined {
  const tasks = leafTasksOf(issue, issues);
  if (tasks.length === 0) return undefined;
  const done = tasks.filter((row) => row.status === "done").length;
  return `${done}/${tasks.length}`;
}

describe("buildTreeRowIndexes", () => {
  const e = epic("e1");
  const s1 = story("s1", "e1");
  const s2 = story("s2", "e1");
  const nested = story("nested", "s1");
  const issues = [
    e,
    s1,
    s2,
    nested,
    task("t1", "s1", "done"),
    task("t2", "s1", "todo"),
    task("t3", "s2", "done"),
    task("t4", "nested", "done"),
  ];
  const indexes = buildTreeRowIndexes(issues);

  it("indexes every issue by id and groups children by partOf", () => {
    expect(indexes.byId.size).toBe(issues.length);
    expect(indexes.byId.get("s1")).toBe(s1);
    expect(indexes.childrenByParent.get("e1")?.map((issue) => issue.id)).toEqual([
      "s1",
      "s2",
    ]);
    expect(indexes.childrenByParent.get("s1")?.map((issue) => issue.id)).toEqual([
      "nested",
      "t1",
      "t2",
    ]);
    expect(indexes.childrenByParent.get("nested")?.map((issue) => issue.id)).toEqual([
      "t4",
    ]);
  });

  it("matches leaf-task progress for stories, epics, and absent parents", () => {
    for (const issue of [e, s1, s2, nested]) {
      expect(leafTaskProgressCount(issue, indexes)).toBe(counted(issue, issues));
    }

    const orphanTasks = [task("a", "missing", "done"), task("b", "missing", "todo")];
    const orphanIndexes = buildTreeRowIndexes(orphanTasks);
    const missing = story("missing", "e1");
    expect(leafTaskProgressCount(missing, orphanIndexes)).toBe(
      counted(missing, orphanTasks),
    );
    expect(orphanIndexes.leafTaskProgress.has("e1")).toBe(false);

    const absentEpic = epic("gone");
    const underAbsent = [
      story("s", "gone"),
      task("a", "s", "done"),
      task("b", "s", "todo"),
    ];
    expect(
      leafTaskProgressCount(absentEpic, buildTreeRowIndexes(underAbsent)),
    ).toBe(counted(absentEpic, underAbsent));
  });
});
