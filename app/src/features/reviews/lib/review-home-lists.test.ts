import { describe, expect, it } from "vitest";
import type { IssueRecord, ReviewView } from "@server/schemas";
import { openReviewMeta, reviewHomeLists } from "./review-home-lists";

const PROJECT = "proj";
const NOW = Date.parse("2026-09-29T12:00:00.000Z");

const timestamps = {
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

const workFields = {
  needsAttention: false,
  attentionReason: null,
  archived: false,
};

function project(id: string): IssueRecord {
  return {
    id,
    kind: "project",
    title: id,
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    ...timestamps,
  };
}

function epic(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf,
    order: 0,
    blockedBy: [],
    ...workFields,
    ...timestamps,
  };
}

function story(
  id: string,
  partOf: string,
  overrides: Partial<Extract<IssueRecord, { kind: "story" }>> = {},
): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: 0,
    merged: false,
    reviewedTasks: [],
    ...workFields,
    ...timestamps,
    ...overrides,
  };
}

function task(
  id: string,
  partOf: string,
  status: "todo" | "in-progress" | "done",
): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    order: 0,
    status,
    commits: [],
    ...workFields,
    ...timestamps,
  };
}

function review(overrides: Partial<ReviewView> & Pick<ReviewView, "id">): ReviewView {
  return {
    projectId: PROJECT,
    target: { kind: "story", storyId: "story" },
    status: "open",
    postMortem: false,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    marks: { all: {}, commits: {} },
    progress: {
      all: { reviewed: 7, total: 12, changedSinceReviewed: [] },
      commits: {},
    },
    effectiveStatus: "open",
    ...overrides,
  } as ReviewView;
}

describe("reviewHomeLists", () => {
  it("puts an unmerged all-tasks-done Story without a review in Ready for review", () => {
    const lists = reviewHomeLists(PROJECT, [
      project(PROJECT),
      epic("epic", PROJECT),
      story("ready-story", "epic", { title: "Work tree cleanup" }),
      task("ready-task", "ready-story", "done"),
      story("still-open", PROJECT),
      task("open-task", "still-open", "in-progress"),
      story("no-tasks", PROJECT),
      story("other-ready", "other-project"),
      task("other-task", "other-ready", "done"),
    ], []);

    expect(lists.ready.map((item) => item.story.id)).toEqual(["ready-story"]);
    expect(lists.ready[0]?.taskCount).toBe(1);
    expect(lists.open).toEqual([]);
    expect(lists.archived).toEqual([]);
  });

  it("puts a merged Story's non-post-mortem review in Archived", () => {
    const lists = reviewHomeLists(
      PROJECT,
      [
        project(PROJECT),
        story("landed", PROJECT, { merged: true, title: "Cursor SDK cost metrics" }),
        task("landed-task", "landed", "done"),
      ],
      [
        review({
          id: "rev-landed",
          target: { kind: "story", storyId: "landed" },
          postMortem: false,
          status: "open",
          effectiveStatus: "archived",
          archivedReason: "merged",
        }),
      ],
    );

    expect(lists.archived.map((item) => item.review.id)).toEqual(["rev-landed"]);
    expect(lists.open).toEqual([]);
    expect(lists.ready).toEqual([]);
  });

  it("keeps a post-mortem review open and leaves a reviewed Story out of Ready", () => {
    const lists = reviewHomeLists(
      PROJECT,
      [
        project(PROJECT),
        story("post-mortem", PROJECT, { merged: true }),
        task("pm-task", "post-mortem", "done"),
        story("in-review", PROJECT),
        task("in-review-task", "in-review", "done"),
      ],
      [
        review({
          id: "rev-pm",
          target: { kind: "story", storyId: "post-mortem" },
          postMortem: true,
          effectiveStatus: "open",
          updatedAt: "2026-09-29T10:00:00.000Z",
        }),
        review({
          id: "rev-open",
          target: { kind: "story", storyId: "in-review" },
          effectiveStatus: "open",
          updatedAt: "2026-09-29T11:00:00.000Z",
        }),
      ],
    );

    expect(lists.open.map((item) => item.review.id)).toEqual(["rev-open", "rev-pm"]);
    expect(lists.ready).toEqual([]);
    expect(lists.archived).toEqual([]);
  });

  it("keeps an explicitly archived review out of Ready and Open", () => {
    const lists = reviewHomeLists(
      PROJECT,
      [
        project(PROJECT),
        story("paused", PROJECT),
        task("paused-task", "paused", "done"),
      ],
      [
        review({
          id: "rev-paused",
          target: { kind: "story", storyId: "paused" },
          status: "archived",
          effectiveStatus: "archived",
          archivedReason: "explicit",
        }),
      ],
    );

    expect(lists.archived.map((item) => item.review.id)).toEqual(["rev-paused"]);
    expect(lists.ready).toEqual([]);
    expect(lists.open).toEqual([]);
  });
});

function metaText(clauses: { text: string }[][]): string {
  return clauses.map((clause) => clause.map((part) => part.text).join("")).join(" · ");
}

describe("openReviewMeta", () => {
  it("includes the changed-since-reviewed count only when it is non-zero", () => {
    const quiet = review({ id: "quiet" });
    expect(metaText(openReviewMeta(quiet, NOW))).toBe(
      "7 / 12 files reviewed · Updated 12h ago",
    );

    const changed = review({
      id: "changed",
      progress: {
        all: {
          reviewed: 7,
          total: 12,
          changedSinceReviewed: ["a.ts", "b.ts", "c.ts"],
        },
        commits: {},
      },
    });
    expect(metaText(openReviewMeta(changed, NOW))).toBe(
      "7 / 12 files reviewed · 3 changed since reviewed · Updated 12h ago",
    );
    const changedClause = openReviewMeta(changed, NOW)[1] ?? [];
    expect(changedClause.every((part) => part.tone === "warn")).toBe(true);
  });
});
