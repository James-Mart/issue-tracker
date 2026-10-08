import { describe, expect, it, vi } from "vitest";
import type { PrFacts } from "@server/services/delivery";
import { IDLE_ROW_PR, RowPrStore } from "./row-pr-store";

function facts(number: number): PrFacts {
  return {
    number,
    url: `https://github.com/acme/widgets/pull/${number}`,
    state: "open",
    isDraft: false,
    mergeable: "mergeable",
    mergeStateStatus: "CLEAN",
    reviewDecision: "approved",
    checks: { state: "success", failing: 0, pending: 0, total: 1 },
    commentCount: number,
    comments: [],
    headRefOid: "abc",
    baseRefName: "main",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

describe("RowPrStore", () => {
  it("notifies only subscribed rows whose entry reference changed", () => {
    const store = new RowPrStore();
    const storyA = vi.fn();
    const storyB = vi.fn();
    store.subscribe("story-a", storyA);
    store.subscribe("story-b", storyB);

    expect(store.get("story-a")).toBe(IDLE_ROW_PR);
    expect(store.get("task-a")).toBe(IDLE_ROW_PR);

    const entryA = facts(1);
    const entryB = facts(2);
    const generation = store.stage(
      { prs: { "story-a": entryA, "story-b": entryB } },
      null,
    );
    expect(generation).toBe(1);
    store.flush();
    expect(storyA).toHaveBeenCalledTimes(1);
    expect(storyB).toHaveBeenCalledTimes(1);

    const sliceA = store.get("story-a");
    expect(sliceA.entry).toBe(entryA);
    expect(store.get("story-a")).toBe(sliceA);

    const nextA = facts(1);
    const unchanged = store.stage(
      { prs: { "story-a": nextA, "story-b": entryB } },
      null,
    );
    expect(unchanged).toBe(2);
    store.flush();
    expect(storyA).toHaveBeenCalledTimes(2);
    expect(storyB).toHaveBeenCalledTimes(1);
    expect(store.get("story-b").entry).toBe(entryB);
    expect(store.get("story-b")).toBe(store.get("story-b"));
  });

  it("keeps the same slice when a refetch repeats an entry reference", () => {
    const store = new RowPrStore();
    const storyB = vi.fn();
    store.subscribe("story-b", storyB);
    const entryA = facts(1);
    const entryB = facts(2);
    store.stage({ prs: { "story-a": entryA, "story-b": entryB } }, null);
    store.flush();
    expect(storyB).toHaveBeenCalledTimes(1);
    const sliceB = store.get("story-b");

    const generation = store.stage(
      { prs: { "story-a": facts(9), "story-b": entryB } },
      null,
    );
    expect(generation).toBe(1);
    store.flush();
    expect(storyB).toHaveBeenCalledTimes(1);
    expect(store.get("story-b")).toBe(sliceB);
  });
});
