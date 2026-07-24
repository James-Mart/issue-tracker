import { describe, expect, it } from "vitest";
import {
  applyCatalogLabelsPlan,
  assignmentLabelsEqual,
  catalogDraftsFromIssue,
  catalogLabelsEqual,
  isLabelAssignableIssue,
  isLabelAssignableKind,
  issueMatchesLabelFilter,
  labelChipTextColor,
  normalizeCatalogLabel,
  planCatalogLabelsSave,
  projectCatalogLabels,
  resolveAssignedLabels,
  sanitizeAssignmentIds,
  toggleAssignmentId,
  validateCatalogDraft,
  validateCatalogDrafts,
} from "./project-labels";
import { issuesById } from "./build-tree";
import type { IssueRecord } from "@server/schemas";

describe("assignment helpers", () => {
  it("recognizes assignable kinds", () => {
    expect(isLabelAssignableKind("epic")).toBe(true);
    expect(isLabelAssignableKind("idea")).toBe(true);
    expect(isLabelAssignableKind("story")).toBe(true);
    expect(isLabelAssignableKind("task")).toBe(false);
    expect(isLabelAssignableKind("project")).toBe(false);
    expect(
      isLabelAssignableIssue({
        id: "i",
        kind: "idea",
        title: "Idea",
        partOf: "p",
        archived: false,
        order: 0,
        createdAt: "",
        updatedAt: "",
      }),
    ).toBe(true);
  });

  it("compares assignment arrays", () => {
    expect(assignmentLabelsEqual(undefined, [])).toBe(true);
    expect(assignmentLabelsEqual(["a"], ["a"])).toBe(true);
    expect(assignmentLabelsEqual(["a"], ["b"])).toBe(false);
    expect(assignmentLabelsEqual(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("resolves assignment ids against the catalog in order", () => {
    const catalog = [
      { id: "bug", color: "#ff0000", description: "Defect" },
      { id: "feat", color: "#00ff00" },
    ];
    expect(resolveAssignedLabels(["feat", "missing", "bug"], catalog)).toEqual([
      { id: "feat", color: "#00ff00" },
      { id: "bug", color: "#ff0000", description: "Defect" },
    ]);
    expect(resolveAssignedLabels(undefined, catalog)).toEqual([]);
  });

  it("sanitizes assignment ids to catalog members", () => {
    const catalog = [
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    ];
    expect(sanitizeAssignmentIds(["feat", "gone", "bug"], catalog)).toEqual([
      "feat",
      "bug",
    ]);
    expect(sanitizeAssignmentIds(["gone"], catalog)).toEqual([]);
  });

  it("reads project catalog labels from the issue map", () => {
    const issues: IssueRecord[] = [
      {
        id: "p",
        kind: "project",
        title: "P",
        mergePolicy: "manual",
        order: 0,
        createdAt: "",
        updatedAt: "",
        labels: [{ id: "bug", color: "#ff0000" }],
      },
      {
        id: "e",
        kind: "epic",
        title: "E",
        partOf: "p",
        blockedBy: [],
        needsAttention: false,
        attentionReason: null,
        archived: false,
        order: 0,
        createdAt: "",
        updatedAt: "",
      },
    ];
    const byId = issuesById(issues);
    expect(projectCatalogLabels(byId, "p")).toEqual([
      { id: "bug", color: "#ff0000" },
    ]);
    expect(projectCatalogLabels(byId, "missing")).toEqual([]);
    expect(projectCatalogLabels(byId, null)).toEqual([]);
  });

  it("toggles assignment ids while preserving order", () => {
    expect(toggleAssignmentId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleAssignmentId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("matches label filter with OR semantics; empty selection matches all", () => {
    const story: IssueRecord = {
      id: "s",
      kind: "story",
      title: "s",
      partOf: "e",
      order: 0,
      createdAt: "",
      updatedAt: "",
      merged: false,
      needsAttention: false,
      attentionReason: null,
      archived: false,
      labels: ["bug"],
    };
    const task: IssueRecord = {
      id: "t",
      kind: "task",
      title: "t",
      partOf: "s",
      order: 0,
      createdAt: "",
      updatedAt: "",
      status: "todo",
      needsAttention: false,
      attentionReason: null,
      archived: false,
    };
    expect(issueMatchesLabelFilter(story, [])).toBe(true);
    expect(issueMatchesLabelFilter(task, [])).toBe(true);
    expect(issueMatchesLabelFilter(story, ["bug"])).toBe(true);
    expect(issueMatchesLabelFilter(story, ["feat"])).toBe(false);
    expect(issueMatchesLabelFilter(story, ["feat", "bug"])).toBe(true);
    expect(issueMatchesLabelFilter(task, ["bug"])).toBe(false);
  });
});

describe("normalizeCatalogLabel", () => {
  it("omits empty description", () => {
    expect(
      normalizeCatalogLabel({
        key: "k",
        originalId: "bug",
        id: " bug ",
        color: " #ff0000 ",
        description: "  ",
      }),
    ).toEqual({ id: "bug", color: "#ff0000" });
  });

  it("keeps a non-empty description", () => {
    expect(
      normalizeCatalogLabel({
        key: "k",
        originalId: null,
        id: "feat",
        color: "#00ff00",
        description: " Features ",
      }),
    ).toEqual({ id: "feat", color: "#00ff00", description: "Features" });
  });
});

describe("validateCatalogDraft", () => {
  it("rejects invalid color", () => {
    expect(
      validateCatalogDraft({
        key: "k",
        originalId: null,
        id: "bug",
        color: "#fff",
        description: "",
      }),
    ).toMatch(/#RRGGBB/);
  });

  it("rejects non-kebab id", () => {
    expect(
      validateCatalogDraft({
        key: "k",
        originalId: null,
        id: "Bug Label",
        color: "#ff0000",
        description: "",
      }),
    ).toMatch(/kebab-case/);
  });

  it("rejects description over 120 chars", () => {
    expect(
      validateCatalogDraft({
        key: "k",
        originalId: null,
        id: "bug",
        color: "#ff0000",
        description: "x".repeat(121),
      }),
    ).toMatch(/120/);
  });
});

describe("validateCatalogDrafts", () => {
  it("rejects duplicate ids", () => {
    expect(
      validateCatalogDrafts([
        {
          key: "a",
          originalId: "bug",
          id: "bug",
          color: "#ff0000",
          description: "",
        },
        {
          key: "b",
          originalId: null,
          id: "bug",
          color: "#00ff00",
          description: "",
        },
      ]),
    ).toMatch(/Duplicate/);
  });
});

describe("catalogDraftsFromIssue / catalogLabelsEqual", () => {
  it("round-trips catalog entries", () => {
    const labels = [
      { id: "bug", color: "#ff0000", description: "Defects" },
      { id: "feat", color: "#00ff00" },
    ];
    const drafts = catalogDraftsFromIssue(labels);
    expect(drafts.map(normalizeCatalogLabel)).toEqual(labels);
    expect(catalogLabelsEqual(labels, labels)).toBe(true);
    expect(catalogLabelsEqual(undefined, [])).toBe(true);
  });
});

describe("labelChipTextColor", () => {
  it("uses dark text on light backgrounds", () => {
    expect(labelChipTextColor("#eeeeee")).toBe("#111827");
  });

  it("uses light text on dark backgrounds", () => {
    expect(labelChipTextColor("#111111")).toBe("#ffffff");
  });
});

describe("planCatalogLabelsSave", () => {
  it("returns null finalLabels when unchanged", () => {
    const labels = [{ id: "bug", color: "#ff0000" }];
    const result = planCatalogLabelsSave(labels, catalogDraftsFromIssue(labels));
    expect(result).toEqual({
      ok: true,
      plan: { stagingPatches: [], finalLabels: null },
    });
  });

  it("puts a single rename in finalLabels with no staging", () => {
    const persisted = [
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    ];
    const drafts = catalogDraftsFromIssue(persisted);
    drafts[0] = { ...drafts[0], id: "defect", color: "#0000ff" };
    const result = planCatalogLabelsSave(persisted, drafts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.stagingPatches).toEqual([]);
    expect(result.plan.finalLabels).toEqual([
      { id: "defect", color: "#0000ff" },
      { id: "feat", color: "#00ff00" },
    ]);
  });

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

  it("stages a single rename before a remove", () => {
    const persisted = [
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    ];
    const drafts = [
      { ...catalogDraftsFromIssue(persisted)[0], id: "defect" },
    ];
    const result = planCatalogLabelsSave(persisted, drafts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.stagingPatches).toEqual([
      [
        { id: "defect", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    ]);
    expect(result.plan.finalLabels).toEqual([{ id: "defect", color: "#ff0000" }]);
  });

  it("stages multi-renames with draft color/description and skips final when done", () => {
    const persisted = [
      { id: "bug", color: "#ff0000", description: "old" },
      { id: "feat", color: "#00ff00" },
    ];
    const drafts = catalogDraftsFromIssue(persisted);
    drafts[0] = {
      ...drafts[0],
      id: "defect",
      color: "#111111",
      description: "new",
    };
    drafts[1] = { ...drafts[1], id: "feature", color: "#222222" };
    const result = planCatalogLabelsSave(persisted, drafts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.stagingPatches).toEqual([
      [
        { id: "defect", color: "#111111", description: "new" },
        { id: "feat", color: "#00ff00" },
      ],
      [
        { id: "defect", color: "#111111", description: "new" },
        { id: "feature", color: "#222222" },
      ],
    ]);
    expect(result.plan.finalLabels).toBeNull();
  });

  it("keeps a finalLabels patch after multi-rename when adds remain", () => {
    const persisted = [
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    ];
    const drafts = [
      ...catalogDraftsFromIssue(persisted).map((draft, i) =>
        i === 0
          ? { ...draft, id: "defect" }
          : { ...draft, id: "feature" },
      ),
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
    expect(result.plan.stagingPatches).toHaveLength(2);
    expect(result.plan.finalLabels).toEqual([
      { id: "defect", color: "#ff0000" },
      { id: "feature", color: "#00ff00" },
      { id: "chore", color: "#0000ff" },
    ]);
  });

  it("returns validation errors", () => {
    const result = planCatalogLabelsSave([], [
      {
        key: "k",
        originalId: null,
        id: "bug",
        color: "#fff",
        description: "",
      },
    ]);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/#RRGGBB/) });
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

  it("returns null finalLabels when already staged", async () => {
    const final = await applyCatalogLabelsPlan(
      {
        stagingPatches: [[{ id: "a", color: "#111111" }]],
        finalLabels: null,
      },
      async () => {},
    );
    expect(final).toBeNull();
  });
});
