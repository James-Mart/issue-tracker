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
  EPIC_STATUS_LABEL,
  QA_STATUS_BADGE_VARIANT,
  RETRO_BADGE_VARIANT,
  SPEC_REVIEW_BADGE_VARIANT,
  STORY_STATUS_BADGE_VARIANT,
  STORY_STATUS_LABEL,
  TASK_STATUS_BADGE_VARIANT,
  TASK_STATUS_LABEL,
  hasInFlightWork,
  isInFlight,
  isIssueComplete,
  statusStages,
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

function stageStates(issue: IssueRecord, state?: DerivedState) {
  return statusStages(issue, state).map((s) => s.state);
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

  it("treats todo and done tasks as not in flight without derived state", () => {
    expect(isInFlight(task("a", "todo"), undefined)).toBe(false);
    expect(isInFlight(task("b", "done"), undefined)).toBe(false);
  });

  it("treats derived in-progress story or epic status as in flight", () => {
    const s = story("s");
    expect(isInFlight(s, { blocked: false, storyStatus: "in-progress" })).toBe(
      true,
    );
    expect(isInFlight(s, { blocked: false, storyStatus: "pr-open" })).toBe(
      false,
    );
    expect(
      isInFlight(
        { id: "e", kind: "epic", title: "e", partOf: "p", ...timestamps },
        { blocked: false, epicStatus: "in-progress" },
      ),
    ).toBe(true);
  });

  it("detects in-flight work across a set", () => {
    const issues = [task("a", "todo"), task("b", "done"), story("s")];
    const idle = {
      "a": { blocked: false },
      "b": { blocked: false },
      s: { blocked: false, storyStatus: "not-started" as const },
    };
    expect(hasInFlightWork(issues, idle)).toBe(false);

    const active = {
      ...idle,
      s: { blocked: false, storyStatus: "in-progress" as const },
    };
    expect(hasInFlightWork(issues, active)).toBe(true);

    const taskActive = {
      ...idle,
      a: { blocked: false },
      b: { blocked: false },
      s: { blocked: false, storyStatus: "not-started" as const },
    };
    expect(hasInFlightWork([task("t", "fixing")], taskActive)).toBe(true);
  });
});

describe("statusStages", () => {
  it("emits todo → in-progress → done for tasks", () => {
    const stages = statusStages(task("t", "todo"), undefined);
    expect(stages.map((s) => s.label)).toEqual([
      TASK_STATUS_LABEL.todo,
      TASK_STATUS_LABEL["in-progress"],
      TASK_STATUS_LABEL.done,
    ]);
    expect(stageStates(task("t", "todo"))).toEqual([
      "current",
      "idle",
      "idle",
    ]);
    expect(stageStates(task("t", "in-progress"))).toEqual([
      "done",
      "current",
      "idle",
    ]);
    expect(stageStates(task("t", "done"))).toEqual(["done", "done", "done"]);
  });

  it("keeps the current dot on in-progress for a fixing task", () => {
    expect(statusStages(task("a", "fixing"), undefined)).toEqual(
      statusStages(task("b", "in-progress"), undefined),
    );
    expect(stageStates(task("a", "fixing"))).toEqual([
      "done",
      "current",
      "idle",
    ]);
  });

  it("lights the right story stage for each status", () => {
    const s = story("s");
    for (const status of STORY_STATUSES) {
      const stages = statusStages(s, { blocked: false, storyStatus: status });
      expect(stages.map((st) => st.label)).toEqual(
        STORY_STATUSES.map((id) => STORY_STATUS_LABEL[id]),
      );
      const idx = STORY_STATUSES.indexOf(status);
      if (status === "merged") {
        expect(stages.every((st) => st.state === "done")).toBe(true);
      } else {
        expect(stages.map((st) => st.state)).toEqual(
          STORY_STATUSES.map((_, i) =>
            i < idx ? "done" : i === idx ? "current" : "idle",
          ),
        );
      }
    }
  });

  it("lights the right epic stage for each status", () => {
    const e = epic("e");
    for (const status of EPIC_STATUSES) {
      const stages = statusStages(e, { blocked: false, epicStatus: status });
      expect(stages.map((st) => st.label)).toEqual(
        EPIC_STATUSES.map((id) => EPIC_STATUS_LABEL[id]),
      );
      const idx = EPIC_STATUSES.indexOf(status);
      if (status === "done") {
        expect(stages.every((st) => st.state === "done")).toBe(true);
      } else {
        expect(stages.map((st) => st.state)).toEqual(
          EPIC_STATUSES.map((_, i) =>
            i < idx ? "done" : i === idx ? "current" : "idle",
          ),
        );
      }
    }
  });

  it("returns [] for kinds with no stage sequence", () => {
    expect(
      statusStages(
        {
          id: "p",
          kind: "project",
          title: "p",
          ...timestamps,
        },
        undefined,
      ),
    ).toEqual([]);
    expect(
      statusStages(
        {
          id: "i",
          kind: "idea",
          title: "i",
          partOf: "p",
          ...timestamps,
        },
        undefined,
      ),
    ).toEqual([]);
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
