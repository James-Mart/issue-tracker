import { describe, expect, it } from "vitest";
import type { Issue } from "../schemas.js";
import {
  planLabelCatalogCascade,
  planLabelCatalogRename,
  removedCatalogIds,
  singleCatalogIdRename,
} from "./labels.js";

const AT = "2026-07-09T14:00:00.000Z";

const project = (
  id: string,
  extra: Partial<Extract<Issue, { kind: "project" }>> = {},
): Extract<Issue, { kind: "project" }> => ({
  id,
  kind: "project",
  title: id,
  mergePolicy: "manual",
  order: 0,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const epic = (
  id: string,
  partOf: string,
  extra: Partial<Extract<Issue, { kind: "epic" }>> = {},
): Extract<Issue, { kind: "epic" }> => ({
  id,
  kind: "epic",
  title: id,
  partOf,
  order: 0,
  blockedBy: [],
  needsAttention: false,
  attentionReason: null,
  archived: false,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const idea = (
  id: string,
  partOf: string,
  extra: Partial<Extract<Issue, { kind: "idea" }>> = {},
): Extract<Issue, { kind: "idea" }> => ({
  id,
  kind: "idea",
  title: id,
  partOf,
  order: 0,
  archived: false,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const story = (
  id: string,
  partOf: string,
  extra: Partial<Extract<Issue, { kind: "story" }>> = {},
): Extract<Issue, { kind: "story" }> => ({
  id,
  kind: "story",
  title: id,
  partOf,
  order: 0,
  merged: false,
  needsAttention: false,
  attentionReason: null,
  archived: false,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

describe("planLabelCatalogCascade", () => {
  it("strips removed catalog ids from assignments in the same Project", () => {
    const existing = project("p", {
      labels: [
        { id: "bug", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    const next = project("p", {
      labels: [{ id: "feat", color: "#00ff00" }],
    });
    expect(removedCatalogIds(existing, next)).toEqual(["bug"]);

    const issues: Issue[] = [
      existing,
      epic("e", "p", { labels: ["bug", "feat"] }),
      idea("i", "p", { labels: ["bug"] }),
      story("s", "e", { labels: ["feat", "bug"] }),
      project("other", {
        labels: [{ id: "bug", color: "#0000ff" }],
      }),
      epic("e-other", "other", { labels: ["bug"] }),
    ];

    expect(planLabelCatalogCascade(existing, next, issues)).toEqual([
      { id: "e", labels: ["feat"] },
      { id: "i", labels: [] },
      { id: "s", labels: ["feat"] },
    ]);
  });

  it("plans nothing when the catalog is unchanged", () => {
    const existing = project("p", {
      labels: [{ id: "bug", color: "#ff0000" }],
    });
    expect(planLabelCatalogCascade(existing, existing, [existing])).toEqual([]);
  });
});

describe("planLabelCatalogRename", () => {
  it("rewrites the catalog entry and matching assignments", () => {
    const proj = project("p", {
      labels: [
        { id: "bug", color: "#ff0000", description: "Defects" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    const issues: Issue[] = [
      proj,
      epic("e", "p", { labels: ["bug", "feat"] }),
      story("s", "e", { labels: ["bug"] }),
    ];

    const planned = planLabelCatalogRename(proj, "bug", "defect", issues);
    expect(planned.projectLabels).toEqual([
      { id: "defect", color: "#ff0000", description: "Defects" },
      { id: "feat", color: "#00ff00" },
    ]);
    expect(planned.assignmentPatches).toEqual([
      { id: "e", labels: ["defect", "feat"] },
      { id: "s", labels: ["defect"] },
    ]);
  });

  it("refuses when newId already exists", () => {
    const proj = project("p", {
      labels: [
        { id: "bug", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    expect(() => planLabelCatalogRename(proj, "bug", "feat", [proj])).toThrow(
      /already exists/,
    );
  });

  it("refuses a non-kebab newId", () => {
    const proj = project("p", {
      labels: [{ id: "bug", color: "#ff0000" }],
    });
    expect(() => planLabelCatalogRename(proj, "bug", "Bug!", [proj])).toThrow(
      /kebab-case/,
    );
  });
});

describe("singleCatalogIdRename", () => {
  it("detects a one-id swap on a same-length catalog", () => {
    const existing = project("p", {
      labels: [
        { id: "bug", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    const next = project("p", {
      labels: [
        { id: "defect", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    expect(singleCatalogIdRename(existing, next)).toEqual({
      oldId: "bug",
      newId: "defect",
    });
  });

  it("returns null when an entry is removed", () => {
    const existing = project("p", {
      labels: [
        { id: "bug", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    const next = project("p", {
      labels: [{ id: "feat", color: "#00ff00" }],
    });
    expect(singleCatalogIdRename(existing, next)).toBeNull();
  });

  it("returns null when two ids change at once", () => {
    const existing = project("p", {
      labels: [
        { id: "bug", color: "#ff0000" },
        { id: "feat", color: "#00ff00" },
      ],
    });
    const next = project("p", {
      labels: [
        { id: "defect", color: "#ff0000" },
        { id: "feature", color: "#00ff00" },
      ],
    });
    expect(singleCatalogIdRename(existing, next)).toBeNull();
  });
});
