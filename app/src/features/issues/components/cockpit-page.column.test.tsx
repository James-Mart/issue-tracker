// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { COCKPIT_COLUMN_CLASS } from "@/components/page-shell";
import { CockpitPage } from "./cockpit-page";

const mockState = vi.hoisted(() => ({
  isLoading: false,
  error: null as Error | null,
  issues: [] as IssueRecord[],
  derived: {},
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: mockState.issues, derived: mockState.derived },
    isLoading: mockState.isLoading,
    error: mockState.error,
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

function mountCockpit(width = "1280px") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.style.width = width;
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

function columnsFrom(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("div")].filter((el) =>
    el.className.includes(COCKPIT_COLUMN_CLASS),
  );
}

describe("CockpitPage column cap", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    mockState.isLoading = false;
    mockState.error = null;
    mockState.issues = [];
    mockState.derived = {};
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
  });

  it("wraps the header and bucket stack in the cockpit column", () => {
    mockState.issues = [project("p-a", "Project A", 0)];
    ({ container, root } = mountCockpit("1280px"));

    const [column] = columnsFrom(container!);
    expect(column).toBeTruthy();
    expect(column!.querySelector("header")?.textContent).toContain("Cockpit");
    expect(column!.querySelector("button[aria-label='Projects']")).toBeTruthy();
  });

  it("wraps the empty-projects state in the cockpit column", () => {
    ({ container, root } = mountCockpit("1280px"));

    const [column] = columnsFrom(container!);
    expect(column?.textContent).toContain("No projects on the line.");
  });

  it("uses w-full so the column fills the page below the cap", () => {
    mockState.issues = [project("p-a", "Project A", 0)];
    ({ container, root } = mountCockpit("390px"));

    const [column] = columnsFrom(container!);
    expect(column?.className).toContain("w-full");
    expect(column?.className).toContain("max-w-[var(--content-max)]");
  });

  it("wraps loading and error states in the same column", () => {
    mockState.isLoading = true;
    ({ container, root } = mountCockpit("1280px"));
    expect(columnsFrom(container!)).toHaveLength(1);
    expect(container!.textContent).toContain("Loading the line");

    act(() => root!.unmount());
    container!.remove();

    mockState.isLoading = false;
    mockState.error = new Error("offline");
    ({ container, root } = mountCockpit("1280px"));
    expect(columnsFrom(container!)).toHaveLength(1);
    expect(container!.textContent).toContain("Couldn't load the line.");
  });
});
