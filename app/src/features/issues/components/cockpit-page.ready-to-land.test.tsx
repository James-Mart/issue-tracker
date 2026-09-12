// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
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

function project(id: string): IssueRecord {
  return {
    id,
    kind: "project",
    title: `Project ${id}`,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
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
  extras: Partial<Extract<IssueRecord, { kind: "story" }>> = {},
): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: extras.order ?? 0,
    createdAt: t0,
    updatedAt: t0,
    branchName: id,
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...extras,
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
    status: "done",
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

afterEach(() => {
  document.body.innerHTML = "";
  mockState.issues = [];
  mockState.derived = {};
  resetCockpitLaunchStore();
});

describe("CockpitPage Ready-to-land rows", () => {
  it("groups adjacent epic-child siblings under one caption and skips project-level Stories", () => {
    mockState.issues = [
      project("p"),
      epic("auth-stack", "p", "Auth / Delegate stack"),
      story("root-pr", "p", { prUrl: "https://github.com/org/repo/pull/1" }),
      { ...story("root-manual", "p"), mergePolicy: "manual" },
      task("root-manual-t", "root-manual"),
      story("child-a", "auth-stack", {
        prUrl: "https://github.com/org/repo/pull/2",
      }),
      story("child-b", "auth-stack", {
        prUrl: "https://github.com/org/repo/pull/3",
      }),
    ];
    mockState.derived = {
      "root-pr": { blocked: false, storyStatus: "pr-open" },
      "root-manual": {
        blocked: false,
        storyStatus: "in-progress",
        mergePolicy: "manual",
      },
      "auth-stack": { blocked: false, epicStatus: "in-progress" },
      "child-a": { blocked: false, storyStatus: "pr-open" },
      "child-b": { blocked: false, storyStatus: "pr-open" },
    };

    const { container } = mountCockpit();
    const readyToLand = section(container, "readyToLand");
    expect(readyToLand).toBeTruthy();

    const captions = [
      ...(readyToLand?.querySelectorAll(
        '[data-testid="ready-to-land-epic-caption"]',
      ) ?? []),
    ];
    expect(captions).toHaveLength(1);
    expect(captions[0]?.textContent).toBe("Auth / Delegate stack");
    expect(captions[0]?.className).not.toMatch(/font-mono/);

    const projectHeaders = [
      ...(readyToLand?.querySelectorAll("h3") ?? []),
    ].map((node) => node.textContent);
    expect(projectHeaders).toEqual(["Project p"]);

    expect(readyToLand?.textContent).toContain("awaiting PR");
    expect(
      readyToLand?.querySelectorAll('a[aria-label="Open PR"]'),
    ).toHaveLength(3);
    expect(readyToLand?.textContent).not.toMatch(/create pr|merge/i);
    expect(
      readyToLand?.querySelectorAll('[data-state="ready-to-land"]'),
    ).toHaveLength(4);
    expect(
      readyToLand
        ?.querySelector('[data-testid="flow-bucket-rail"]')
        ?.getAttribute("data-live"),
    ).toBe("false");
  });

  it("keeps Open PR and an Epic caption on a flagged Ready-to-land Story in Needs attention", () => {
    mockState.issues = [
      project("p"),
      epic("auth-stack", "p", "Auth / Delegate stack"),
      {
        ...story("flagged", "auth-stack", {
          prUrl: "https://github.com/org/repo/pull/4",
        }),
        needsAttention: true,
        attentionReason: "check",
      },
    ];
    mockState.derived = {
      "auth-stack": { blocked: false, epicStatus: "in-progress" },
      flagged: { blocked: false, storyStatus: "pr-open" },
    };

    const { container } = mountCockpit();
    const attention = section(container, "needsAttention");
    expect(attention).toBeTruthy();
    expect(section(container, "readyToLand")).toBeNull();

    const captions = attention?.querySelectorAll(
      '[data-testid="ready-to-land-epic-caption"]',
    );
    expect(captions).toHaveLength(1);
    expect(captions?.[0]?.textContent).toBe("Auth / Delegate stack");
    expect(
      attention?.querySelector('a[aria-label="Open PR"]'),
    ).toBeTruthy();
    expect(
      attention?.querySelector('[data-state="needs-attention"]'),
    ).toBeTruthy();
  });
});
