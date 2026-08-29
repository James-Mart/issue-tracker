// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY } from "../lib/cockpit-collapsed-sections";
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

function headingButton(container: ParentNode, key: string): HTMLButtonElement | null {
  const match = container.querySelector(`#cockpit-${key}`);
  return match instanceof HTMLButtonElement ? match : null;
}

function sectionBody(container: ParentNode, key: string): HTMLElement | null {
  return container.querySelector(`#cockpit-${key}-body`);
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  document.cookie = "cockpit_hidden_project_ids=; path=/; max-age=0";
  mockState.issues = [
    project("p-alpha", "Alpha", 0),
    epic("ready-alpha", "p-alpha"),
    epic("flight-alpha", "p-alpha"),
  ];
  mockState.derived = {
    "ready-alpha": { blocked: false, epicStatus: "todo" },
    "flight-alpha": { blocked: false, epicStatus: "in-progress" },
  };
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CockpitPage collapse persistence", () => {
  it("restores a collapsed band after remount", () => {
    const first = mountCockpit();
    expect(sectionBody(first.container, "inFlight")).toBeTruthy();

    act(() => {
      headingButton(first.container, "inFlight")?.click();
    });

    expect(sectionBody(first.container, "inFlight")).toBeNull();
    expect(localStorage.getItem(COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY)).toBe(
      JSON.stringify(["inFlight"]),
    );

    act(() => {
      first.root.unmount();
    });

    const second = mountCockpit();
    expect(sectionBody(second.container, "inFlight")).toBeNull();
    expect(sectionBody(second.container, "ready")).toBeTruthy();
    expect(
      headingButton(second.container, "inFlight")?.getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
