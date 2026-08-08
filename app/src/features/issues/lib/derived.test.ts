import { describe, expect, it } from "vitest";
import {
  EPIC_STATUSES,
  QA_STATUSES,
  RETRO_STATUSES,
  SPEC_REVIEW_STATUSES,
  STORY_STATUSES,
  TASK_STATUSES,
  type DerivedState,
  type IssueRecord,
} from "@server/schemas";
import { BADGE_VARIANTS } from "@/components/ui/badge";
import {
  EPIC_STATUS_BADGE_VARIANT,
  QA_STATUS_BADGE_VARIANT,
  RETRO_BADGE_VARIANT,
  SPEC_REVIEW_BADGE_VARIANT,
  STORY_STATUS_BADGE_VARIANT,
  TASK_STATUS_BADGE_VARIANT,
  hasInFlightWork,
  isInFlight,
  isIssueComplete,
  leafTaskProgressCount,
  leafTasksOf,
} from "./derived";

const timestamps = {
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

function task(
  id: string,
  status: IssueRecord & { kind: "task" }["status"],
): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf: "story",
    status,
    ...timestamps,
  };
}

function story(id: string): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf: "epic",
    branchName: id,
    merged: false,
    ...timestamps,
  };
}

function epic(id: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "project",
    ...timestamps,
  };
}

const badgeVariantSet = new Set<string>(BADGE_VARIANTS);

function expectMapCovers<S extends string>(
  statuses: readonly S[],
  map: Record<S, string>,
) {
  for (const status of statuses) {
    expect(badgeVariantSet.has(map[status])).toBe(true);
  }
}

describe("status badge variant maps", () => {
  it("maps every task status to an existing Badge variant", () => {
    expectMapCovers(TASK_STATUSES, TASK_STATUS_BADGE_VARIANT);
  });

  it("maps fixing to the current hue (not warn)", () => {
    expect(TASK_STATUS_BADGE_VARIANT.fixing).toBe("current");
    expect(TASK_STATUS_BADGE_VARIANT.fixing).not.toBe("warn");
    expect(TASK_STATUS_BADGE_VARIANT["in-progress"]).toBe("inProgress");
  });

  it("maps every qa status to an existing Badge variant", () => {
    expectMapCovers(QA_STATUSES, QA_STATUS_BADGE_VARIANT);
  });

  it("maps every story status to an existing Badge variant", () => {
    expectMapCovers(STORY_STATUSES, STORY_STATUS_BADGE_VARIANT);
  });

  it("maps every epic status to an existing Badge variant", () => {
    expectMapCovers(EPIC_STATUSES, EPIC_STATUS_BADGE_VARIANT);
  });

  it("maps every specReview status to an existing Badge variant", () => {
    expectMapCovers(SPEC_REVIEW_STATUSES, SPEC_REVIEW_BADGE_VARIANT);
  });

  it("maps every retro status to an existing Badge variant", () => {
    expectMapCovers(RETRO_STATUSES, RETRO_BADGE_VARIANT);
  });
});

describe("liveness helpers", () => {
  it("treats in-progress and fixing tasks as in flight", () => {
    expect(isInFlight(task("a", "in-progress"), undefined)).toBe(true);
    expect(isInFlight(task("b", "fixing"), undefined)).toBe(true);
  });

  it("treats todo and done tasks as not in flight", () => {
    expect(isInFlight(task("a", "todo"), undefined)).toBe(false);
    expect(isInFlight(task("b", "done"), undefined)).toBe(false);
  });

  it("does not treat derived in-progress story or epic status as in flight", () => {
    const s = story("s");
    expect(isInFlight(s, { blocked: false, storyStatus: "in-progress" })).toBe(
      false,
    );
    expect(
      isInFlight(
        { id: "e", kind: "epic", title: "e", partOf: "p", ...timestamps },
        { blocked: false, epicStatus: "in-progress" },
      ),
    ).toBe(false);
  });

  it("detects in-flight work across a set", () => {
    const issues = [task("a", "todo"), task("b", "done"), story("s")];
    const idle = {
      "a": { blocked: false },
      "b": { blocked: false },
      s: { blocked: false, storyStatus: "not-started" as const },
    };
    expect(hasInFlightWork(issues, idle)).toBe(false);

    const storyOnlyActive = {
      ...idle,
      s: { blocked: false, storyStatus: "in-progress" as const },
    };
    expect(hasInFlightWork(issues, storyOnlyActive)).toBe(false);

    expect(hasInFlightWork([task("t", "fixing")], idle)).toBe(true);
    expect(hasInFlightWork([task("t", "in-progress")], idle)).toBe(true);
  });
});

describe("leafTaskProgressCount", () => {
  it("returns done/total for story leaf tasks", () => {
    const s = story("s1");
    const issues = [
      s,
      { ...task("t1", "done"), partOf: "s1" },
      { ...task("t2", "todo"), partOf: "s1" },
      { ...task("t3", "done"), partOf: "s1" },
    ];
    expect(leafTasksOf(s, issues)).toHaveLength(3);
    expect(leafTaskProgressCount(s, issues)).toBe("2/3");
  });

  it("aggregates tasks across stories under an epic", () => {
    const e = epic("e1");
    const issues = [
      e,
      { ...story("s1"), partOf: "e1" },
      { ...story("s2"), partOf: "e1" },
      { ...task("t1", "done"), partOf: "s1" },
      { ...task("t2", "done"), partOf: "s1" },
      { ...task("t3", "todo"), partOf: "s2" },
    ];
    expect(leafTaskProgressCount(e, issues)).toBe("2/3");
  });

  it("returns undefined when there are no leaf tasks", () => {
    expect(leafTaskProgressCount(task("t", "todo"), [task("t", "todo")])).toBe(
      undefined,
    );
    expect(leafTaskProgressCount(epic("e"), [epic("e")])).toBe(undefined);
  });
});

describe("isIssueComplete", () => {
  it("treats task done, story merged, and epic done as complete", () => {
    expect(isIssueComplete(task("t", "done"), undefined)).toBe(true);
    expect(isIssueComplete(task("t", "todo"), undefined)).toBe(false);
    expect(
      isIssueComplete(story("s"), { blocked: false, storyStatus: "merged" }),
    ).toBe(true);
    expect(
      isIssueComplete(
        { ...story("s"), merged: true },
        { blocked: false, storyStatus: "not-started" },
      ),
    ).toBe(true);
    expect(
      isIssueComplete(epic("e"), { blocked: false, epicStatus: "done" }),
    ).toBe(true);
    expect(
      isIssueComplete(epic("e"), { blocked: false, epicStatus: "todo" }),
    ).toBe(false);
  });

  it("returns false for kinds without completion", () => {
    expect(
      isIssueComplete(
        { id: "i", kind: "idea", title: "i", partOf: "p", ...timestamps },
        undefined,
      ),
    ).toBe(false);
  });
});
