import { describe, expect, it } from "vitest";
import {
  PHONE_RUN_LIST_SLOTS,
  buildRunListSegments,
  chooseVisibleRunIds,
  conditionBadgeLabel,
  formatRunStartedAt,
  recoveredMarkerLabel,
  runListSegments,
  type RecentRun,
} from "./run-list";

function run(
  conversationId: string,
  condition: RecentRun["condition"] = "completed",
): RecentRun {
  return {
    conversationId,
    coordinatorLabel: conversationId,
    startedAt: "2026-08-28T12:00:00.000Z",
    condition,
  };
}

const newestFirst = [
  run("a"),
  run("b"),
  run("c"),
  run("d", "failed"),
  run("e"),
];

describe("chooseVisibleRunIds", () => {
  it("pins the selected run and the newest failed run, then fills newest-first", () => {
    const visible = chooseVisibleRunIds(
      newestFirst,
      "e",
      PHONE_RUN_LIST_SLOTS,
    );
    expect([...visible]).toEqual(["e", "d", "a"]);
  });

  it("does not pin a selection that is not in the fetched list", () => {
    const visible = chooseVisibleRunIds(
      newestFirst,
      "missing",
      PHONE_RUN_LIST_SLOTS,
    );
    expect([...visible]).toEqual(["d", "a", "b"]);
  });

  it("treats a selected failed run as a single pin", () => {
    const visible = chooseVisibleRunIds(
      newestFirst,
      "d",
      PHONE_RUN_LIST_SLOTS,
    );
    expect([...visible]).toEqual(["d", "a", "b"]);
  });
});

describe("buildRunListSegments", () => {
  it("marks each omission where it falls in newest-first order", () => {
    const segments = buildRunListSegments(
      newestFirst,
      new Set(["a", "d", "e"]),
    );
    expect(segments).toEqual([
      { kind: "run", run: newestFirst[0] },
      { kind: "elision", omitted: [newestFirst[1], newestFirst[2]] },
      { kind: "run", run: newestFirst[3] },
      { kind: "run", run: newestFirst[4] },
    ]);
  });
});

describe("runListSegments", () => {
  it("renders every run when the list is not truncated", () => {
    expect(runListSegments(newestFirst, "e", null)).toEqual(
      newestFirst.map((row) => ({ kind: "run", run: row })),
    );
    expect(
      runListSegments(newestFirst.slice(0, 3), "a", PHONE_RUN_LIST_SLOTS),
    ).toEqual(
      newestFirst.slice(0, 3).map((row) => ({ kind: "run", run: row })),
    );
  });

  it("keeps the selected run and newest failed run visible on the phone cap", () => {
    const segments = runListSegments(
      newestFirst,
      "e",
      PHONE_RUN_LIST_SLOTS,
    );
    expect(
      segments
        .filter((segment) => segment.kind === "run")
        .map((segment) => segment.run.conversationId),
    ).toEqual(["a", "d", "e"]);
    expect(segments[1]).toEqual({
      kind: "elision",
      omitted: [newestFirst[1], newestFirst[2]],
    });
  });
});

describe("formatRunStartedAt", () => {
  const now = new Date("2026-08-28T15:00:00.000Z");

  it("labels today and yesterday, and otherwise the weekday", () => {
    expect(formatRunStartedAt("2026-08-28T09:12:00.000Z", now)).toMatch(
      /^Today, /,
    );
    expect(formatRunStartedAt("2026-08-27T21:41:00.000Z", now)).toMatch(
      /^Yesterday, /,
    );
    expect(formatRunStartedAt("2026-08-26T16:22:00.000Z", now)).toMatch(
      /^[A-Z][a-z]{2}, /,
    );
  });

  it("returns the raw string when the timestamp is not a date", () => {
    expect(formatRunStartedAt("not-a-date", now)).toBe("not-a-date");
  });
});

describe("conditionBadgeLabel", () => {
  it("maps each condition to the list badge copy", () => {
    expect(conditionBadgeLabel("in-flight")).toBe("live");
    expect(conditionBadgeLabel("completed")).toBe("done");
    expect(conditionBadgeLabel("failed")).toBe("failed");
  });
});

describe("recoveredMarkerLabel", () => {
  it("returns the recovered count in ↻ form", () => {
    expect(recoveredMarkerLabel(1)).toBe("↻1");
    expect(recoveredMarkerLabel(2)).toBe("↻2");
  });
});
