import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { visibleIssues } from "@server/services/archived-visibility";
import { partitionCockpitBuckets } from "../components/flow-buckets-sections";
import { issuesById } from "./build-tree";
import {
  depGraphModel,
  epicDependencyNeighborhood,
  filterFlowBuckets,
  flowBuckets,
  flowFiltersActive,
  flowItemNeedsAttention,
  inFlightTaskOf,
  type FlowBuckets,
  type FlowFilters,
} from "./flow";

const noFilters: FlowFilters = { search: "", labelIds: [], kind: [] };

const t0 = "2026-07-01T00:00:00.000Z";
const t1 = "2026-07-02T00:00:00.000Z";
const t2 = "2026-07-03T00:00:00.000Z";

function project(id: string): IssueRecord {
  return {
    id,
    kind: "project",
    title: id,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
  };
}

function epic(
  id: string,
  partOf: string,
  updatedAt = t0,
  blockedBy: string[] = [],
): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt,
    needsAttention: false,
    attentionReason: null,
    blockedBy,
    archived: false,
  };
}

function story(
  id: string,
  partOf: string,
  updatedAt = t0,
): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt,
    branchName: id,
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

function task(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    status: "todo",
    needsAttention: false,
    attentionReason: null,
  };
}

function idea(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "idea",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
  };
}

function labeledStory(
  id: string,
  partOf: string,
  labels: string[],
): IssueRecord {
  return { ...story(id, partOf), labels };
}

function labeledEpic(
  id: string,
  partOf: string,
  labels: string[],
): IssueRecord {
  return { ...epic(id, partOf), labels };
}

function ids(items: { issue: IssueRecord }[]): string[] {
  return items.map((item) => item.issue.id);
}

function bucketIds(buckets: FlowBuckets): Record<keyof FlowBuckets, string[]> {
  return {
    awaitingPlanning: ids(buckets.awaitingPlanning),
    ready: ids(buckets.ready),
    inFlight: ids(buckets.inFlight),
    blocked: ids(buckets.blocked),
    recentlyMerged: ids(buckets.recentlyMerged),
  };
}

describe("flowBuckets", () => {
  it("assigns each Story/Epic to exactly one bucket by precedence", () => {
    const issues = [
      project("p"),
      epic("blocked-epic", "p"),
      story("blocked-story", "blocked-epic"),
      epic("flight-epic", "p"),
      story("flight-story", "flight-epic"),
      story("pr-story", "flight-epic"),
      epic("done-epic", "p"),
      story("merged-story", "done-epic"),
      epic("ready-epic", "p"),
      story("ready-story", "ready-epic"),
    ];
    const derived: Record<string, DerivedState> = {
      "blocked-epic": { blocked: true, epicStatus: "in-progress" },
      "blocked-story": { blocked: true, storyStatus: "pr-open" },
      "flight-epic": { blocked: false, epicStatus: "in-progress" },
      "flight-story": { blocked: false, storyStatus: "in-progress" },
      "pr-story": { blocked: false, storyStatus: "pr-open" },
      "done-epic": { blocked: false, epicStatus: "done" },
      "merged-story": { blocked: false, storyStatus: "merged" },
      "ready-epic": { blocked: false, epicStatus: "todo" },
      "ready-story": { blocked: false, storyStatus: "not-started" },
    };

    const buckets = flowBuckets(issues, derived, { projectId: "p" });

    expect(ids(buckets.blocked).sort()).toEqual(["blocked-epic"].sort());
    expect(ids(buckets.inFlight).sort()).toEqual(["flight-epic"].sort());
    expect(ids(buckets.recentlyMerged).sort()).toEqual(["done-epic"].sort());
    expect(ids(buckets.ready).sort()).toEqual(["ready-epic"].sort());
  });

  it("puts blocked ahead of inFlight and recentlyMerged", () => {
    const issues = [
      project("p"),
      epic("e", "p"),
      story("s-flight", "e"),
      story("s-merged", "e"),
    ];
    const derived: Record<string, DerivedState> = {
      e: { blocked: true, epicStatus: "done" },
      "s-flight": { blocked: true, storyStatus: "in-progress" },
      "s-merged": { blocked: true, storyStatus: "merged" },
    };

    const buckets = flowBuckets(issues, derived, {});

    expect(ids(buckets.blocked).sort()).toEqual(["e"].sort());
    expect(buckets.inFlight).toEqual([]);
    expect(buckets.recentlyMerged).toEqual([]);
    expect(buckets.ready).toEqual([]);
  });

  it("orders recentlyMerged by updatedAt descending", () => {
    const issues = [
      project("p"),
      epic("old-epic", "p", t0),
      epic("mid-epic", "p", t1),
      story("new-story", "mid-epic", t2),
    ];
    const derived: Record<string, DerivedState> = {
      "old-epic": { blocked: false, epicStatus: "done" },
      "mid-epic": { blocked: false, epicStatus: "done" },
      "new-story": { blocked: false, storyStatus: "merged" },
    };

    const buckets = flowBuckets(issues, derived, { projectId: "p" });

    expect(ids(buckets.recentlyMerged)).toEqual(["mid-epic", "old-epic"]);
  });

  it("excludes Epic-child Stories, Tasks, Projects, and planned Ideas", () => {
    const issues = [
      project("p"),
      idea("i", "p"),
      epic("e", "p"),
      story("s", "e"),
      task("t", "s"),
    ];
    const derived: Record<string, DerivedState> = {
      i: { blocked: false, ideaStatus: "planned" },
      e: { blocked: false, epicStatus: "todo" },
      s: { blocked: false, storyStatus: "not-started" },
      t: { blocked: false },
    };

    const buckets = flowBuckets(issues, derived, { projectId: "p" });

    expect(ids(buckets.ready).sort()).toEqual(["e"].sort());
    expect(buckets.awaitingPlanning).toEqual([]);
    expect(buckets.inFlight).toEqual([]);
    expect(buckets.blocked).toEqual([]);
    expect(buckets.recentlyMerged).toEqual([]);
  });

  it("places a captured Idea in awaitingPlanning and a planning Idea in inFlight", () => {
    const issues = [
      project("p"),
      idea("planning-idea", "p"),
      idea("captured-idea", "p"),
      idea("planned-idea", "p"),
      idea("awaiting-idea", "p"),
    ];
    const derived: Record<string, DerivedState> = {
      "planning-idea": { blocked: false, ideaStatus: "planning" },
      "captured-idea": { blocked: false, ideaStatus: "captured" },
      "planned-idea": { blocked: false, ideaStatus: "planned" },
      "awaiting-idea": { blocked: false, ideaStatus: "awaiting-direction" },
    };

    const buckets = flowBuckets(issues, derived, { projectId: "p" });

    expect(ids(buckets.awaitingPlanning)).toEqual(["captured-idea"]);
    expect(ids(buckets.inFlight)).toEqual(["planning-idea"]);
    expect(ids(buckets.ready)).toEqual(["awaiting-idea"]);
    expect(ids(buckets.blocked)).toEqual([]);
    expect(ids(buckets.recentlyMerged)).toEqual([]);
  });

  it("scopes to projectId when set and aggregates when omitted", () => {
    const issues = [
      project("p1"),
      project("p2"),
      epic("e1", "p1"),
      story("s1", "e1"),
      epic("e2", "p2"),
      story("s2", "e2"),
    ];
    const derived: Record<string, DerivedState> = {
      e1: { blocked: false, epicStatus: "todo" },
      s1: { blocked: false, storyStatus: "not-started" },
      e2: { blocked: false, epicStatus: "in-progress" },
      s2: { blocked: false, storyStatus: "pr-open" },
    };

    const scoped = flowBuckets(issues, derived, { projectId: "p1" });
    expect(ids(scoped.ready).sort()).toEqual(["e1"].sort());
    expect(scoped.inFlight).toEqual([]);

    const all = flowBuckets(issues, derived, {});
    expect(ids(all.ready).sort()).toEqual(["e1"].sort());
    expect(ids(all.inFlight).sort()).toEqual(["e2"].sort());
  });

  it("rolls child Story pr-open into the parent Epic inFlight bucket", () => {
    const issues = [project("p"), epic("e", "p"), story("s", "e")];
    const derived: Record<string, DerivedState> = {
      e: { blocked: false, epicStatus: "in-progress" },
      s: { blocked: false, storyStatus: "pr-open" },
    };

    const buckets = flowBuckets(issues, derived, { projectId: "p" });
    expect(ids(buckets.inFlight)).toEqual(["e"]);
    expect(ids(buckets.ready)).toEqual([]);
  });

  it("includes project-level Stories alongside Epics", () => {
    const issues = [
      project("p"),
      epic("e", "p"),
      story("root-story", "p"),
    ];
    const derived: Record<string, DerivedState> = {
      e: { blocked: false, epicStatus: "todo" },
      "root-story": { blocked: false, storyStatus: "in-progress" },
    };

    const buckets = flowBuckets(issues, derived, { projectId: "p" });
    expect(ids(buckets.ready).sort()).toEqual(["e"].sort());
    expect(ids(buckets.inFlight).sort()).toEqual(["root-story"].sort());
  });

  it("excludes archived board-level issues from every cockpit bucket", () => {
    const issues = [
      project("p"),
      { ...epic("arch-ready", "p"), archived: true },
      {
        ...story("arch-flight", "p"),
        archived: true,
      },
      { ...epic("arch-blocked", "p"), archived: true },
      { ...idea("arch-captured", "p"), archived: true },
      { ...story("arch-merged", "p", t2), archived: true },
      {
        ...epic("arch-attention", "p"),
        archived: true,
        needsAttention: true,
        attentionReason: "stalled",
      },
      epic("visible-ready", "p"),
    ];
    const derived: Record<string, DerivedState> = {
      "arch-ready": { blocked: false, epicStatus: "todo" },
      "arch-flight": { blocked: false, storyStatus: "in-progress" },
      "arch-blocked": { blocked: true, epicStatus: "todo" },
      "arch-captured": { blocked: false, ideaStatus: "captured" },
      "arch-merged": { blocked: false, storyStatus: "merged" },
      "arch-attention": { blocked: false, epicStatus: "todo" },
      "visible-ready": { blocked: false, epicStatus: "todo" },
    };

    const raw = flowBuckets(issues, derived, {});
    expect(ids(raw.ready).sort()).toEqual(
      [
        "arch-ready",
        "arch-attention",
        "visible-ready",
      ].sort(),
    );

    const cockpit = flowBuckets(visibleIssues(issues, false), derived, {});
    const { needsAttention, buckets } = partitionCockpitBuckets(cockpit);
    const allCockpitIds = [
      ...ids(needsAttention),
      ...ids(buckets.awaitingPlanning),
      ...ids(buckets.ready),
      ...ids(buckets.inFlight),
      ...ids(buckets.blocked),
      ...ids(buckets.recentlyMerged),
    ];

    expect(allCockpitIds).toEqual(["visible-ready"]);
  });

  it("excludes an Epic nested under another Epic", () => {
    const issues = [
      project("p"),
      epic("parent", "p"),
      epic("nested", "parent"),
      story("s", "nested"),
    ];
    const derived: Record<string, DerivedState> = {
      parent: { blocked: false, epicStatus: "in-progress" },
      nested: { blocked: false, epicStatus: "todo" },
      s: { blocked: false, storyStatus: "not-started" },
    };

    const buckets = flowBuckets(issues, derived, { projectId: "p" });
    expect(ids(buckets.inFlight)).toEqual(["parent"]);
    expect(ids(buckets.ready)).toEqual([]);
    expect(ids(buckets.blocked)).toEqual([]);
    expect(ids(buckets.recentlyMerged)).toEqual([]);
  });
});

describe("flowItemNeedsAttention", () => {
  it("treats awaiting-direction Ideas as attention and ignores implementing Stories", () => {
    expect(
      flowItemNeedsAttention({
        issue: idea("awaiting", "p"),
        state: { blocked: false, ideaStatus: "awaiting-direction" },
      }),
    ).toBe(true);
    expect(
      flowItemNeedsAttention({
        issue: idea("planning", "p"),
        state: { blocked: false, ideaStatus: "planning" },
      }),
    ).toBe(false);
    expect(
      flowItemNeedsAttention({
        issue: story("implementing", "p"),
        state: { blocked: false, storyStatus: "in-progress" },
      }),
    ).toBe(false);
  });
});

describe("inFlightTaskOf", () => {
  it("returns the earliest in-progress or fixing task under a Story", () => {
    const tDone = { ...task("t0", "s"), status: "done" as const, order: 0 };
    const tFlight = {
      ...task("t1", "s"),
      status: "in-progress" as const,
      order: 1,
    };
    const tFix = { ...task("t2", "s"), status: "fixing" as const, order: 2 };
    const s = story("s", "e");
    const issues = [project("p"), epic("e", "p"), s, tDone, tFlight, tFix];

    expect(inFlightTaskOf(s, issues)?.id).toBe("t1");
  });

  it("finds a descendant in-flight task under an Epic", () => {
    const tFlight = {
      ...task("t1", "s"),
      status: "in-progress" as const,
    };
    const e = epic("e", "p");
    const issues = [project("p"), e, story("s", "e"), tFlight];

    expect(inFlightTaskOf(e, issues)?.id).toBe("t1");
  });

  it("returns undefined when the row has no in-flight Task", () => {
    const s = story("s", "e");
    const issues = [project("p"), epic("e", "p"), s, task("t", "s")];
    expect(inFlightTaskOf(s, issues)).toBeUndefined();
    expect(inFlightTaskOf(project("p"), issues)).toBeUndefined();
  });

  it("reuses a shared byId map when provided", () => {
    const tFlight = {
      ...task("t1", "s"),
      status: "in-progress" as const,
    };
    const e = epic("e", "p");
    const issues = [project("p"), e, story("s", "e"), tFlight];
    const byId = issuesById(issues);
    expect(inFlightTaskOf(e, issues, byId)?.id).toBe("t1");
  });
});

describe("filterFlowBuckets", () => {
  const issues = [
    project("p"),
    epic("ready-epic", "p"),
    labeledStory("ready-story", "ready-epic", ["bug"]),
    task("ready-task", "ready-story"),
    epic("flight-epic", "p"),
    story("flight-story", "flight-epic"),
  ];
  const derived: Record<string, DerivedState> = {
    "ready-epic": { blocked: false, epicStatus: "todo" },
    "ready-story": { blocked: false, storyStatus: "not-started" },
    "flight-epic": { blocked: false, epicStatus: "in-progress" },
    "flight-story": { blocked: false, storyStatus: "in-progress" },
  };
  const buckets = flowBuckets(issues, derived, { projectId: "p" });

  it("flowFiltersActive is false for defaults", () => {
    expect(flowFiltersActive(noFilters)).toBe(false);
    expect(flowFiltersActive({ ...noFilters, search: "  " })).toBe(false);
  });

  it("returns buckets unchanged when filters are inactive", () => {
    expect(filterFlowBuckets(buckets, issues, noFilters)).toEqual(buckets);
  });

  it("filters by kind (OR multi-select)", () => {
    const epicsOnly = filterFlowBuckets(buckets, issues, {
      ...noFilters,
      kind: ["epic"],
    });
    expect(bucketIds(epicsOnly)).toEqual({
      awaitingPlanning: [],
      ready: ["ready-epic"],
      inFlight: ["flight-epic"],
      blocked: [],
      recentlyMerged: [],
    });

    const ideasOnly = filterFlowBuckets(buckets, issues, {
      ...noFilters,
      kind: ["idea"],
    });
    expect(bucketIds(ideasOnly)).toEqual({
      awaitingPlanning: [],
      ready: [],
      inFlight: [],
      blocked: [],
      recentlyMerged: [],
    });

    const epicsAndStories = filterFlowBuckets(buckets, issues, {
      ...noFilters,
      kind: ["epic", "story"],
    });
    expect(bucketIds(epicsAndStories)).toEqual(bucketIds(buckets));
  });

  it("filters by search on the row or a descendant", () => {
    const byTitle = filterFlowBuckets(buckets, issues, {
      ...noFilters,
      search: "flight-story",
    });
    expect(ids(byTitle.inFlight)).toEqual(["flight-epic"]);
    expect(byTitle.ready).toEqual([]);

    const byTask = filterFlowBuckets(buckets, issues, {
      ...noFilters,
      search: "ready-task",
    });
    expect(ids(byTask.ready)).toEqual(["ready-epic"]);
  });

  it("filters by label OR and composes with kind", () => {
    const labeled = filterFlowBuckets(buckets, issues, {
      ...noFilters,
      labelIds: ["bug"],
    });
    expect(ids(labeled.ready)).toEqual(["ready-epic"]);
    expect(labeled.inFlight).toEqual([]);

    const storiesWithBug = filterFlowBuckets(buckets, issues, {
      search: "",
      labelIds: ["bug"],
      kind: ["story"],
    });
    expect(ids(storiesWithBug.ready)).toEqual([]);
  });

  it("keeps an Epic when labels match it and search matches a child (tree semantics)", () => {
    // AND-at-seed would drop both: epic matches label only, story matches search only.
    const crossIssues = [
      project("p"),
      labeledEpic("labeled-epic", "p", ["bug"]),
      story("search-story", "labeled-epic"),
    ];
    const crossDerived: Record<string, DerivedState> = {
      "labeled-epic": { blocked: false, epicStatus: "todo" },
      "search-story": { blocked: false, storyStatus: "not-started" },
    };
    const crossBuckets = flowBuckets(crossIssues, crossDerived, {
      projectId: "p",
    });
    const filtered = filterFlowBuckets(crossBuckets, crossIssues, {
      search: "search-story",
      labelIds: ["bug"],
      kind: [],
    });
    expect(ids(filtered.ready)).toEqual(["labeled-epic"]);
    expect(filtered.inFlight).toEqual([]);
  });
});

describe("epicDependencyNeighborhood", () => {
  it("returns the focus epic plus direct blockedBy and blocking neighbors", () => {
    // Diamond: D ← B,C ← A. Neighborhood of B is A, B, D (not C).
    const issues = [
      epic("A", "p"),
      epic("B", "p", t0, ["A"]),
      epic("C", "p", t0, ["A"]),
      epic("D", "p", t0, ["B", "C"]),
      story("S", "B"),
    ];

    expect(
      epicDependencyNeighborhood("B", issues)
        .map((e) => e.id)
        .sort(),
    ).toEqual(["A", "B", "D"]);
  });

  it("returns only the focus epic when it has no neighbors", () => {
    const issues = [epic("solo", "p"), epic("other", "p")];
    expect(epicDependencyNeighborhood("solo", issues).map((e) => e.id)).toEqual(
      ["solo"],
    );
  });

  it("returns empty for a missing or non-epic id", () => {
    const issues = [epic("E", "p"), story("S", "E")];
    expect(epicDependencyNeighborhood("missing", issues)).toEqual([]);
    expect(epicDependencyNeighborhood("S", issues)).toEqual([]);
  });

  it("omits dangling blockedBy ids that are not epics in the issue list", () => {
    const issues = [epic("E", "p", t0, ["ghost"])];
    expect(epicDependencyNeighborhood("E", issues).map((e) => e.id)).toEqual([
      "E",
    ]);
  });
});

describe("depGraphModel", () => {
  it("maps diamond DAG node states, prerequisite→dependent edges, and satisfied flags", () => {
    // C blocks A and B; A and B block D (diamond).
    const epics = [
      epic("C", "p"),
      epic("A", "p", t0, ["C"]),
      epic("B", "p", t0, ["C"]),
      epic("D", "p", t0, ["A", "B"]),
    ];
    const derived: Record<string, DerivedState> = {
      C: { blocked: false, epicStatus: "done" },
      A: { blocked: false, epicStatus: "in-progress" },
      B: { blocked: true, epicStatus: "todo" },
      D: { blocked: true, epicStatus: "todo" },
    };

    const model = depGraphModel(epics, derived);

    expect(model.nodes).toEqual([
      { id: "C", label: "C", state: "merged" },
      { id: "A", label: "A", state: "in-flight" },
      { id: "B", label: "B", state: "blocked" },
      { id: "D", label: "D", state: "blocked" },
    ]);

    expect(model.edges).toEqual([
      { from: "C", to: "A", satisfied: true },
      { from: "C", to: "B", satisfied: true },
      { from: "A", to: "D", satisfied: false },
      { from: "B", to: "D", satisfied: false },
    ]);
  });

  it("dedupes duplicate blockedBy entries and prefers blocked over epicStatus", () => {
    const epics = [
      epic("A", "p"),
      epic("B", "p", t0, ["A", "A"]),
      epic("ready", "p"),
    ];
    const derived: Record<string, DerivedState> = {
      A: { blocked: false, epicStatus: "done" },
      B: { blocked: true, epicStatus: "done" },
      ready: { blocked: false, epicStatus: "todo" },
    };

    const model = depGraphModel(epics, derived);

    expect(model.nodes.find((n) => n.id === "B")?.state).toBe("blocked");
    expect(model.nodes.find((n) => n.id === "ready")?.state).toBe("ready");
    expect(model.edges).toEqual([{ from: "A", to: "B", satisfied: true }]);
  });

  it("ignores non-epic records in the input list", () => {
    const issues = [
      project("p"),
      epic("E", "p"),
      story("S", "E"),
      task("T", "S"),
    ];
    const derived: Record<string, DerivedState> = {
      E: { blocked: false, epicStatus: "todo" },
    };

    const model = depGraphModel(issues, derived);
    expect(model.nodes).toEqual([{ id: "E", label: "E", state: "ready" }]);
    expect(model.edges).toEqual([]);
  });

  it("omits edges whose prerequisite is outside the supplied epic set", () => {
    // Neighborhood of B: A,B,D — D also lists C, which is out of set.
    const neighborhood = [
      epic("A", "p"),
      epic("B", "p", t0, ["A"]),
      epic("D", "p", t0, ["B", "C"]),
    ];
    const derived: Record<string, DerivedState> = {
      A: { blocked: false, epicStatus: "todo" },
      B: { blocked: true, epicStatus: "todo" },
      D: { blocked: true, epicStatus: "todo" },
    };

    const model = depGraphModel(neighborhood, derived);
    expect(model.edges).toEqual([
      { from: "A", to: "B", satisfied: false },
      { from: "B", to: "D", satisfied: false },
    ]);
  });
});
