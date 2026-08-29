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

function projectsTrigger(container: ParentNode): HTMLButtonElement | null {
  const match = container.querySelector('button[aria-label="Projects"]');
  return match instanceof HTMLButtonElement ? match : null;
}

function menuCheckbox(label: string): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll('[role="menuitemcheckbox"]'),
    ).find((el) => el.textContent?.trim() === label) ?? null
  );
}

function menuItem(label: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === label,
    ) ?? null
  );
}

function openProjectsMenu(container: ParentNode): HTMLButtonElement {
  const trigger = projectsTrigger(container);
  expect(trigger).toBeTruthy();
  if (trigger!.getAttribute("data-state") !== "open") {
    act(() => {
      trigger!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
      trigger!.click();
    });
  }
  return trigger!;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
    expect(projectsTrigger(container)).toBeNull();
  });

  it("filters projects from the header control", () => {
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
    const trigger = projectsTrigger(container);

    expect(trigger?.textContent).toContain("Projects");
    expect(trigger?.textContent).not.toContain("(");
    expect(trigger?.className).not.toContain("bg-secondary");

    openProjectsMenu(container);
    expect(menuCheckbox("Alpha")?.getAttribute("aria-checked")).toBe("true");
    expect(menuCheckbox("Beta")?.getAttribute("aria-checked")).toBe("true");
    expect(menuItem("Show all")).toBeNull();

    act(() => {
      menuCheckbox("Alpha")!.click();
    });

    expect(readCockpitHiddenProjectIds()).toEqual(["p-alpha"]);
    expect(projectLink(container, "Alpha")).toBeNull();
    expect(projectLink(container, "Beta")).toBeTruthy();
    expect(bucketCount(section(container, "ready"))).toBe(1);
    expect(projectsTrigger(container)?.textContent).toContain("(1)");
    expect(projectsTrigger(container)?.className).toContain("bg-secondary");

    openProjectsMenu(container);
    const showAll = menuItem("Show all");
    expect(showAll).toBeTruthy();
    act(() => {
      showAll!.click();
    });

    expect(readCockpitHiddenProjectIds()).toEqual([]);
    expect(projectLink(container, "Alpha")).toBeTruthy();
    expect(projectLink(container, "Beta")).toBeTruthy();
    expect(bucketCount(section(container, "ready"))).toBe(2);
    expect(projectsTrigger(container)?.textContent).toContain("Projects");
    expect(projectsTrigger(container)?.textContent).not.toContain("(");
    expect(projectsTrigger(container)?.className).not.toContain("bg-secondary");
  });
});
