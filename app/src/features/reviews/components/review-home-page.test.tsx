// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IssueRecord, ReviewView } from "@server/schemas";
import { projectReviewPath, storyReviewPath } from "../lib/links";
import { ReviewHomePage } from "./review-home-page";

const PROJECT = "proj";
const t0 = "2026-09-29T00:00:00.000Z";

const state = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
  reviews: [] as ReviewView[],
  issuesLoading: false,
  reviewsLoading: false,
  issuesError: null as Error | null,
  reviewsError: null as Error | null,
  mutateAsync: vi.fn(),
  reopen: vi.fn(),
}));

vi.mock("@/features/issues/api/queries", () => ({
  useIssuesQuery: () => ({
    data: state.issuesLoading ? undefined : { issues: state.issues, derived: {} },
    isLoading: state.issuesLoading,
    isFetching: false,
    error: state.issuesError,
    refetch: vi.fn(),
  }),
}));

vi.mock("../api/queries", () => ({
  useReviewsQuery: () => ({
    data: state.reviewsLoading ? undefined : { reviews: state.reviews },
    isLoading: state.reviewsLoading,
    isFetching: false,
    error: state.reviewsError,
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
    mutate: state.reopen,
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

function review(overrides: Partial<ReviewView> & Pick<ReviewView, "id">): ReviewView {
  return {
    projectId: PROJECT,
    target: { kind: "story", storyId: "open-story" },
    status: "open",
    postMortem: false,
    createdAt: t0,
    updatedAt: t0,
    marks: { all: {}, commits: {} },
    progress: {
      all: { reviewed: 7, total: 12, changedSinceReviewed: ["a.ts", "b.ts", "c.ts"] },
      commits: {},
    },
    effectiveStatus: "open",
    ...overrides,
  } as ReviewView;
}

let root: Root | undefined;
let lastLocation = "";

function LocationProbe() {
  const location = useLocation();
  lastLocation = `${location.pathname}${location.search}`;
  return null;
}

function mount(entry = `/projects/${PROJECT}/review`): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[entry]}>
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
  state.reviews = [];
  state.issuesLoading = false;
  state.reviewsLoading = false;
  state.issuesError = null;
  state.reviewsError = null;
  state.mutateAsync.mockReset();
  state.reopen.mockReset();
  lastLocation = "";
});

describe("ReviewHomePage", () => {
  it("lists open progress, a ready Story, and a collapsed archive without landing chrome the spec drops", () => {
    state.issues = [
      project(),
      story("open-story", { title: "Code review surface" }),
      task("open-task", "open-story"),
      story("ready-story", { title: "Work tree cleanup" }),
      task("ready-task", "ready-story"),
      story("landed", { title: "Cursor SDK cost metrics", merged: true }),
      task("landed-task", "landed"),
    ];
    state.reviews = [
      review({ id: "rev-open", target: { kind: "story", storyId: "open-story" } }),
      review({
        id: "rev-landed",
        target: { kind: "story", storyId: "landed" },
        effectiveStatus: "archived",
        archivedReason: "merged",
        progress: {
          all: { reviewed: 14, total: 14, changedSinceReviewed: [] },
          commits: {},
        },
      }),
    ];
    const container = mount();

    expect(container.querySelector('[data-testid="review-home-page"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Review home");
    expect(container.textContent).not.toContain("Track file-level");
    expect(container.textContent).not.toContain("in progress");
    expect(container.textContent).not.toContain("code complete");
    expect(container.textContent).not.toContain("PR open");

    const codeReview = [...container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "Code review",
    );
    expect(codeReview?.getAttribute("aria-current")).toBe("page");
    expect(codeReview?.getAttribute("href")).toBe(projectReviewPath(PROJECT));
    const structure = [...container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "Structure",
    );
    expect(structure?.getAttribute("href")).toBe(`/projects/${PROJECT}`);

    const openRow = container.querySelector('[data-testid="review-home-open-row"]');
    expect(openRow?.textContent).toContain("Code review surface");
    expect(openRow?.textContent).toContain("open-story");
    expect(openRow?.textContent).toContain("7 / 12 files reviewed");
    expect(openRow?.textContent).toContain("3 changed since reviewed");
    expect(openRow?.getAttribute("href")).toBe(storyReviewPath(PROJECT, "open-story"));

    expect(container.querySelector('[data-testid="review-home-ready-row"]')?.textContent).toContain(
      "Work tree cleanup",
    );
    expect(container.querySelector('[data-testid="review-home-start"]')?.textContent).toBe(
      "Start review",
    );

    const archived = container.querySelector("details");
    expect(archived?.open).toBe(false);
    expect(container.textContent).toContain("Archived");
  });

  it("shows an empty state for each list, including an expanded empty archive", () => {
    state.issues = [project()];
    const container = mount();
    expect(container.textContent).toContain("No open reviews");
    expect(container.textContent).toContain("Nothing ready for review");
    const archived = container.querySelector<HTMLDetailsElement>(
      '[data-testid="review-home-archived"]',
    );
    expect(archived).not.toBeNull();
    archived!.open = true;
    expect(container.textContent).toContain("No archived reviews");
  });

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

  it("stays on the landing page when open-or-create fails", async () => {
    state.issues = [
      project(),
      story("ready-story"),
      task("ready-task", "ready-story"),
    ];
    state.mutateAsync.mockRejectedValue(new Error("refused"));
    const container = mount();
    await click(container.querySelector('[data-testid="review-home-start"]')!);
    expect(lastLocation).toBe(`/projects/${PROJECT}/review`);
  });

  it("reopens an archived review from the expanded section", async () => {
    state.issues = [
      project(),
      story("landed", { merged: true, title: "Cursor SDK cost metrics" }),
    ];
    state.reviews = [
      review({
        id: "rev-landed",
        target: { kind: "story", storyId: "landed" },
        effectiveStatus: "archived",
        archivedReason: "merged",
      }),
    ];
    const container = mount();
    const archived = container.querySelector<HTMLDetailsElement>(
      '[data-testid="review-home-archived"]',
    );
    archived!.open = true;
    const reopen = container.querySelector('[data-testid="review-home-reopen"]');
    expect(reopen?.textContent).toBe("Reopen");
    await click(reopen!);
    expect(state.reopen).toHaveBeenCalledWith("rev-landed");
  });
});
