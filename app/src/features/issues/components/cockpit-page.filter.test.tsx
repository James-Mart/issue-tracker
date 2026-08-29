// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import {
  readCockpitHiddenProjectIds,
  writeCockpitHiddenProjectIds,
} from "../lib/cockpit-hidden-projects";
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
    order,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
  };
}

function epic(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
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

function bucketCount(sectionEl: HTMLElement | null): number | null {
  if (!sectionEl) return null;
  const countEl = sectionEl.querySelector(".tabular-nums");
  return countEl ? Number(countEl.textContent) : null;
}

function projectLink(
  container: ParentNode,
  title: string,
): HTMLAnchorElement | null {
  const match = Array.from(container.querySelectorAll("a")).find(
    (el) => el.textContent?.trim() === title,
  );
  return match instanceof HTMLAnchorElement ? match : null;
}

beforeEach(() => {
  document.cookie = "cockpit_hidden_project_ids=; path=/; max-age=0";
  mockState.issues = [];
  mockState.derived = {};
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CockpitPage project filter", () => {
  it("omits hidden project groups and keeps bucket counts for visible work", () => {
    writeCockpitHiddenProjectIds(["p-alpha"]);
    mockState.issues = [
      project("p-alpha", "Alpha", 0),
      project("p-beta", "Beta", 1),
      epic("ready-alpha", "p-alpha"),
      epic("ready-beta", "p-beta"),
    ];
    mockState.derived = {
      "ready-alpha": { blocked: false, epicStatus: "todo" },
      "ready-beta": { blocked: false, epicStatus: "todo" },
    };

    const { container } = mountCockpit();

    expect(projectLink(container, "Alpha")).toBeNull();
    expect(projectLink(container, "Beta")).toBeTruthy();
    expect(bucketCount(section(container, "ready"))).toBe(1);
  });

  it("omits empty buckets after filtering", () => {
    mockState.issues = [
      project("p-alpha", "Alpha", 0),
      project("p-beta", "Beta", 1),
      epic("ready-alpha", "p-alpha"),
    ];
    mockState.derived = {
      "ready-alpha": { blocked: false, epicStatus: "todo" },
    };

    const { container } = mountCockpit();

    expect(section(container, "ready")).toBeTruthy();
    expect(section(container, "inFlight")).toBeNull();
    expect(section(container, "awaitingPlanning")).toBeNull();
  });

  it("shows the filtered empty state when every project is hidden", () => {
    writeCockpitHiddenProjectIds(["p-alpha", "p-beta"]);
    mockState.issues = [
      project("p-alpha", "Alpha", 0),
      project("p-beta", "Beta", 1),
      epic("ready-alpha", "p-alpha"),
      epic("ready-beta", "p-beta"),
    ];
    mockState.derived = {
      "ready-alpha": { blocked: false, epicStatus: "todo" },
      "ready-beta": { blocked: false, epicStatus: "todo" },
    };

    const { container } = mountCockpit();

    expect(container.textContent).toContain("No projects in view.");
    expect(container.textContent).toContain("Filtered");
    expect(section(container, "ready")).toBeNull();

    const showAll = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent?.trim() === "Show all projects",
    );
    expect(showAll).toBeTruthy();

    act(() => {
      showAll!.click();
    });

    expect(readCockpitHiddenProjectIds()).toEqual([]);
    expect(projectLink(container, "Alpha")).toBeTruthy();
    expect(projectLink(container, "Beta")).toBeTruthy();
    expect(bucketCount(section(container, "ready"))).toBe(2);
  });

  it("keeps the zero-project empty shell when there are no projects", () => {
    const { container } = mountCockpit();

    expect(container.textContent).toContain("No projects on the line.");
    expect(container.textContent).toContain("Empty");
    expect(container.textContent).not.toContain("No projects in view.");
  });
});
