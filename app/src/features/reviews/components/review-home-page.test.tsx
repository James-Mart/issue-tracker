// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { storyReviewPath } from "../lib/links";
import { ReviewHomePage } from "./review-home-page";

const PROJECT = "proj";
const t0 = "2026-09-29T00:00:00.000Z";

const state = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
  mutateAsync: vi.fn(),
}));

vi.mock("@/features/issues/api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: state.issues, derived: {} },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../api/queries", () => ({
  useReviewsQuery: () => ({
    data: { reviews: [] },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  useReviewProgressQuery: () => ({ data: undefined, error: null, isPending: false }),
  useReviewCandidatesQuery: () => ({
    data: { stories: [] },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../api/mutations", () => ({
  useOpenReview: () => ({
    mutateAsync: state.mutateAsync,
    isPending: false,
    variables: undefined,
  }),
  useReopenReview: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
}));

function project(): IssueRecord {
  return {
    id: PROJECT,
    kind: "project",
    title: "issue-tracker",
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
  };
}

function story(
  id: string,
  overrides: Partial<Extract<IssueRecord, { kind: "story" }>> = {},
): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf: PROJECT,
    order: 0,
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    createdAt: t0,
    updatedAt: t0,
    ...overrides,
  };
}

function task(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    order: 0,
    status: "done",
    commits: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    createdAt: t0,
    updatedAt: t0,
  };
}

let root: Root | undefined;
let lastLocation = "";

function LocationProbe() {
  const location = useLocation();
  lastLocation = `${location.pathname}${location.search}`;
  return null;
}

function mount(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[`/projects/${PROJECT}/review`]}>
        <LocationProbe />
        <Routes>
          <Route path="/projects/:projectId/review" element={<ReviewHomePage />} />
          <Route path="/projects/:projectId/review/stories/:storyId" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

function Probe(): ReactNode {
  return null;
}

function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  state.issues = [];
  state.mutateAsync.mockReset();
  lastLocation = "";
});

describe("ReviewHomePage", () => {
  it("starts a review and navigates to it", async () => {
    state.issues = [
      project(),
      story("ready-story", { title: "Work tree cleanup" }),
      task("ready-task", "ready-story"),
    ];
    state.mutateAsync.mockResolvedValue(undefined);
    const container = mount();
    const start = container.querySelector('[data-testid="review-home-start"]');
    expect(start).not.toBeNull();
    await click(start!);
    expect(state.mutateAsync).toHaveBeenCalledWith("ready-story");
    expect(lastLocation).toBe(storyReviewPath(PROJECT, "ready-story"));
  });
});
