import { describe, expect, it } from "vitest";
import { stackedStoryOrder } from "./order";
import type { Issue } from "./schemas";

type Story = Extract<Issue, { kind: "story" }>;

const branch = (
  id: string,
  order: number,
  extra: Partial<Story> = {},
): Story => ({
  id,
  kind: "story",
  title: id,
  partOf: "e",
  order,
  merged: false,
  reviewedTasks: [],
  archived: false,
  needsAttention: false,
  attentionReason: null,
  createdAt: "2026-07-10T14:00:00.000Z",
  updatedAt: "2026-07-10T14:00:00.000Z",
  ...extra,
});

const ids = (branches: Story[]): string[] => branches.map((b) => b.id);

describe("stackedStoryOrder", () => {
  it("emits each root immediately followed by what is stacked on it (depth-first)", () => {
    const a = branch("a", 0);
    const b = branch("b", 0, { stackedOn: "a" });
    const c = branch("c", 0, { stackedOn: "b" });
    expect(ids(stackedStoryOrder([c, a, b]))).toEqual(["a", "b", "c"]);
  });

  it("terminates on a pure stackedOn cycle (both are children, so no root anchors traversal)", () => {
    const a = branch("a", 0, { stackedOn: "b" });
    const b = branch("b", 0, { stackedOn: "a" });
    expect(stackedStoryOrder([a, b])).toEqual([]);
  });
});
