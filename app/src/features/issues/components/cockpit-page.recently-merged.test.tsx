// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY } from "../lib/cockpit-collapsed-sections";
import { writeCockpitHiddenProjectIds } from "../lib/cockpit-hidden-projects";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { CockpitPage } from "./cockpit-page";

const mockState = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
  derived: {} as Record<string, DerivedState>,
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: mockState.issues, derived: mockState.derived },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useProjectPullRequestsQuery: () => ({
    data: undefined,
    error: null,
  }),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] },
    isLoading: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useUpdateIssue: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../hooks/use-confirm-channel-live-run", () => ({
  useConfirmChannelLiveRun: () => ({
    confirmIfLiveRun: (action: () => void) => {
      action();
    },
    awaitingConfirm: false,
    confirming: false,
    dialog: null,
  }),
}));

vi.mock("../store/use-issue-ui-store", () => ({
  useIssueUiStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openProjectDialog: vi.fn() }),
}));

const t0 = "2026-07-01T00:00:00.000Z";

function project(id: string, title: string, order: number): IssueRecord {
  return {
    id,
    kind: "project",
    title,
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order,
    createdAt: t0,
    updatedAt: t0,
  };
}

function epic(id: string, partOf: string, title = id): IssueRecord {
  return {
    id,
    kind: "epic",
    title,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
  };
}

function story(
  id: string,
  partOf: string,
  title: string,
  extras: Partial<Extract<IssueRecord, { kind: "story" }>> = {},
): Extract<IssueRecord, { kind: "story" }> {
  return {
    id,
    kind: "story",
    title,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    branchName: id,
    merged: true,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...extras,
  };
}

function mountCockpit(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <CockpitPage />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function section(container: ParentNode, key: string): HTMLElement | null {
  return container.querySelector(`section[aria-labelledby="cockpit-${key}"]`);
}

function rowTitles(root: ParentNode | null): string[] {
  return [...(root?.querySelectorAll(".cockpit-row-title") ?? [])].map(
    (node) => node.textContent ?? "",
  );
}

function projectLabels(root: ParentNode | null): string[] {
  return [
    ...(root?.querySelectorAll('[data-testid="cockpit-row-project"]') ?? []),
  ].map((node) => node.textContent ?? "");
}

function bucketCount(sectionEl: HTMLElement | null): number | null {
  if (!sectionEl) return null;
  const countEl = sectionEl.querySelector(".tabular-nums");
  return countEl ? Number(countEl.textContent) : null;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.cookie = "cockpit_hidden_project_ids=; path=/; max-age=0";
  localStorage.removeItem(COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY);
  mockState.issues = [];
  mockState.derived = {};
});

afterEach(() => {
  document.body.innerHTML = "";
  resetCockpitLaunchStore();
});

describe("CockpitPage recently merged", () => {
  it("lists one cross-project timeline and keeps other sections grouped", () => {
    mockState.issues = [
      project("alpha", "Alpha", 0),
      project("beta", "Beta", 1),
      epic("ready-alpha", "alpha", "Alpha ready"),
      epic("ready-beta", "beta", "Beta ready"),
      story("beta-new", "beta", "Beta landed", {
        mergedAt: "2026-07-03T00:00:00.000Z",
        updatedAt: t0,
      }),
      epic("alpha-stack", "alpha", "Alpha stack"),
      story("alpha-late", "alpha-stack", "Late child", {
        mergedAt: "2026-07-02T00:00:00.000Z",
      }),
      story("alpha-early", "alpha-stack", "Early child", {
        mergedAt: t0,
      }),
      story("alpha-old", "alpha", "Alpha landed", {
        mergedAt: t0,
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
      story("beta-missing", "beta", "Beta missing stamp"),
      epic("alpha-empty", "alpha", "Alpha empty"),
    ];
    mockState.derived = {
      "ready-alpha": { blocked: false, epicStatus: "todo" },
      "ready-beta": { blocked: false, epicStatus: "todo" },
      "beta-new": { blocked: false, storyStatus: "merged" },
      "alpha-stack": { blocked: false, epicStatus: "done" },
      "alpha-late": { blocked: false, storyStatus: "merged" },
      "alpha-early": { blocked: false, storyStatus: "merged" },
      "alpha-old": { blocked: false, storyStatus: "merged" },
      "beta-missing": { blocked: false, storyStatus: "merged" },
      "alpha-empty": { blocked: false, epicStatus: "done" },
    };

    const { container } = mountCockpit();
    const merged = section(container, "recentlyMerged");
    const ready = section(container, "ready");

    expect(bucketCount(merged)).toBe(3);
    expect(merged?.querySelectorAll("h3")).toHaveLength(0);
    expect(merged?.querySelectorAll('[data-testid="flow-bucket-rail"]')).toHaveLength(1);
    expect(rowTitles(merged)).toEqual([
      "Beta landed",
      "Alpha stack",
      "Alpha landed",
    ]);
    expect(projectLabels(merged)).toEqual(["Beta", "Alpha", "Alpha"]);
    expect(
      merged?.querySelectorAll('[data-testid="cockpit-row-action-slot"]'),
    ).toHaveLength(3);
    expect(merged?.textContent).not.toContain("Beta missing stamp");
    expect(merged?.textContent).not.toContain("Alpha empty");
    expect(merged?.textContent).not.toContain("Late child");

    expect(ready?.querySelectorAll("h3")).toHaveLength(2);
    expect(rowTitles(ready)).toEqual(["Alpha ready", "Beta ready"]);
    expect(projectLabels(ready)).toEqual([]);
  });

  it("previews five rows across projects, then Show all reveals the rest", () => {
    const mergedAt = (day: number) =>
      `2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`;
    mockState.issues = [
      project("alpha", "Alpha", 0),
      project("beta", "Beta", 1),
      epic("ready-alpha", "alpha", "Alpha ready"),
    ];
    mockState.derived = {
      "ready-alpha": { blocked: false, epicStatus: "todo" },
    };
    for (let index = 0; index < 3; index += 1) {
      const day = index * 2 + 1;
      const id = `alpha-${index}`;
      mockState.issues.push(
        story(id, "alpha", `Alpha ${day}`, { mergedAt: mergedAt(day) }),
      );
      mockState.derived[id] = { blocked: false, storyStatus: "merged" };
    }
    for (let index = 0; index < 3; index += 1) {
      const day = index * 2 + 2;
      const id = `beta-${index}`;
      mockState.issues.push(
        story(id, "beta", `Beta ${day}`, { mergedAt: mergedAt(day) }),
      );
      mockState.derived[id] = { blocked: false, storyStatus: "merged" };
    }

    const { container } = mountCockpit();
    const merged = section(container, "recentlyMerged");

    expect(bucketCount(merged)).toBe(6);
    expect(merged?.querySelectorAll("h3")).toHaveLength(0);
    expect(rowTitles(merged)).toEqual([
      "Beta 6",
      "Alpha 5",
      "Beta 4",
      "Alpha 3",
      "Beta 2",
    ]);
    expect(projectLabels(merged)).toEqual([
      "Beta",
      "Alpha",
      "Beta",
      "Alpha",
      "Beta",
    ]);

    const showAll = [...(merged?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Show all",
    );
    expect(showAll).toBeTruthy();
    act(() => {
      showAll?.click();
    });
    expect(rowTitles(merged)).toEqual([
      "Beta 6",
      "Alpha 5",
      "Beta 4",
      "Alpha 3",
      "Beta 2",
      "Alpha 1",
    ]);
    expect(bucketCount(merged)).toBe(6);
    expect(merged?.textContent).not.toContain("Show all");
  });

  it("keeps the PR control on a merged Story that still has a pull request", () => {
    mockState.issues = [
      project("alpha", "Alpha", 0),
      story("landed", "alpha", "Alpha landed", {
        mergedAt: t0,
        prUrl: "https://github.com/org/repo/pull/9",
      }),
    ];
    mockState.derived = {
      landed: { blocked: false, storyStatus: "merged" },
    };

    const { container } = mountCockpit();
    const merged = section(container, "recentlyMerged");
    expect(
      merged?.querySelector('[data-testid="cockpit-row-action-slot"] a[aria-label="Open PR"]'),
    ).toBeTruthy();
    expect(projectLabels(merged)).toEqual(["Alpha"]);
  });

  it("omits merged rows from hidden projects", () => {
    writeCockpitHiddenProjectIds(["alpha"]);
    mockState.issues = [
      project("alpha", "Alpha", 0),
      project("beta", "Beta", 1),
      story("alpha-new", "alpha", "Alpha landed", {
        mergedAt: "2026-07-03T00:00:00.000Z",
      }),
      story("beta-old", "beta", "Beta landed", { mergedAt: t0 }),
    ];
    mockState.derived = {
      "alpha-new": { blocked: false, storyStatus: "merged" },
      "beta-old": { blocked: false, storyStatus: "merged" },
    };

    const { container } = mountCockpit();
    const merged = section(container, "recentlyMerged");

    expect(rowTitles(merged)).toEqual(["Beta landed"]);
    expect(projectLabels(merged)).toEqual(["Beta"]);
    expect(bucketCount(merged)).toBe(1);
  });
});
