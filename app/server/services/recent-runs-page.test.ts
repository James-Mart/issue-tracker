import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AT,
  AT_EARLY,
  AT_LATE,
  loadRecentRunsPage,
  prompt,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  writeConversation,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

describe("recentRunsPage", () => {
  it("pages newest-first with a nextCursor, no overlap or gap, and null at the end", async () => {
    writeConversation("conv-a", {
      meta: { title: "A", createdAt: AT_EARLY },
      transcript: [prompt("hi", AT_EARLY, 1)],
    });
    writeConversation("conv-b", {
      meta: { title: "B", createdAt: AT },
      transcript: [prompt("hi", AT, 1)],
    });
    writeConversation("conv-c", {
      meta: { title: "C", createdAt: AT_LATE },
      transcript: [prompt("hi", AT_LATE, 1)],
    });

    const recentRunsPage = await loadRecentRunsPage();

    const first = recentRunsPage({ limit: 2 });
    expect(first.runs.map((row) => row.conversationId)).toEqual([
      "conv-c",
      "conv-b",
    ]);
    expect(first.nextCursor).toBe(`${AT}|conv-b`);

    const second = recentRunsPage({ limit: 2, cursor: first.nextCursor! });
    expect(second.runs.map((row) => row.conversationId)).toEqual(["conv-a"]);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.runs, ...second.runs].map((row) => row.conversationId);
    expect(ids).toEqual(["conv-c", "conv-b", "conv-a"]);
  });
});
