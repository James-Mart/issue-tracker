import { describe, expect, it } from "vitest";
import {
  applyCatalogLabelsPlan,
  catalogDraftsFromIssue,
  planCatalogLabelsSave,
} from "./project-labels";

describe("planCatalogLabelsSave", () => {
  it("stages a single rename before an add so assignment rewrite can fire", () => {
    const persisted = [
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    ];
    const drafts = [
      { ...catalogDraftsFromIssue(persisted)[0], id: "defect", color: "#111111" },
      catalogDraftsFromIssue(persisted)[1],
      {
        key: "new-1",
        originalId: null,
        id: "chore",
        color: "#0000ff",
        description: "",
      },
    ];
    const result = planCatalogLabelsSave(persisted, drafts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.stagingPatches).toEqual([
      [
        { id: "defect", color: "#111111" },
        { id: "feat", color: "#00ff00" },
      ],
    ]);
    expect(result.plan.finalLabels).toEqual([
      { id: "defect", color: "#111111" },
      { id: "feat", color: "#00ff00" },
      { id: "chore", color: "#0000ff" },
    ]);
  });
});

describe("applyCatalogLabelsPlan", () => {
  it("applies staging patches in order and returns finalLabels", async () => {
    const applied: string[][] = [];
    const final = await applyCatalogLabelsPlan(
      {
        stagingPatches: [
          [{ id: "a", color: "#111111" }],
          [
            { id: "a", color: "#111111" },
            { id: "b", color: "#222222" },
          ],
        ],
        finalLabels: [
          { id: "a", color: "#111111" },
          { id: "b", color: "#222222" },
          { id: "c", color: "#333333" },
        ],
      },
      async (labels) => {
        applied.push(labels.map((label) => label.id));
      },
    );
    expect(applied).toEqual([["a"], ["a", "b"]]);
    expect(final).toEqual([
      { id: "a", color: "#111111" },
      { id: "b", color: "#222222" },
      { id: "c", color: "#333333" },
    ]);
  });
});
