// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IssueRecord, ReviewPrSource, ReviewRecordView } from "@server/schemas";
import { reviewIssuePath } from "../lib/links";
import { ReviewHomePage } from "./review-home-page";

const PROJECT = "proj";
const t0 = "2026-09-29T00:00:00.000Z";

const state = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
  reviews: [] as ReviewRecordView[],
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
    data: { reviews: state.reviews },
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
  useOpenReviewFromPr: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
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
          <Route path="/projects/:projectId/review/issues/:id" element={<Probe />} />
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
  state.mutateAsync.mockReset();
  lastLocation = "";
});

function openReview(
  id: string,
  overrides: Partial<ReviewRecordView> = {},
): ReviewRecordView {
  return {
    id,
    kind: "review",
    partOf: PROJECT,
    title: id,
    archived: false,
    order: 0,
    status: "open",
    createdAt: t0,
    updatedAt: t0,
    marks: { all: {}, commits: {} },
    submissions: [],
    ...overrides,
  } as ReviewRecordView;
}

function reviewPrSource(number: number): ReviewPrSource {
  return {
    url: `https://github.com/acme/issue-tracker/pull/${number}`,
    number,
    baseRef: "main",
    headRef: "pr-head",
    headSha: "abc",
    fork: false,
  };
}

function openCard(row: Element): HTMLElement {
  const card = row.closest("li");
  if (!card) throw new Error("review row has no card");
  return card;
}

describe("ReviewHomePage", () => {
  it("starts a review and navigates to it", async () => {
    state.issues = [
      project(),
      story("ready-story", { title: "Work tree cleanup" }),
      task("ready-task", "ready-story"),
    ];
    state.mutateAsync.mockResolvedValue({ id: "ready-review" });
    const container = mount();
    const start = container.querySelector('[data-testid="review-home-start"]');
    expect(start).not.toBeNull();
    await click(start!);
    expect(state.mutateAsync).toHaveBeenCalledWith("ready-story");
    expect(lastLocation).toBe(reviewIssuePath(PROJECT, "ready-review"));
  });

  it("keeps one flat list per section and identifies each review source", () => {
    state.issues = [
      project(),
      story("story-only", { title: "Comment threads" }),
      story("both-sources", { title: "External import" }),
      story("archived-story", { title: "Story detail" }),
      story("ready-story", { title: "Ready story" }),
      task("ready-task", "ready-story"),
    ];
    state.reviews = [
      openReview("rev-story", { story: "story-only" }),
      openReview("rev-pr", { title: "Bump the sdk", pr: reviewPrSource(318) }),
      openReview("rev-both", { story: "both-sources", pr: reviewPrSource(482) }),
      openReview("rev-missing", { story: "gone", pr: reviewPrSource(9) }),
      openReview("rev-archived-pr", {
        status: "archived",
        archivedReason: "explicit",
        title: "Capture presets",
        pr: reviewPrSource(401),
      }),
      openReview("rev-archived-story", {
        status: "archived",
        archivedReason: "merged",
        story: "archived-story",
      }),
    ];
    const container = mount();

    const openSection = container.querySelector("#review-home-open-heading")?.closest("section");
    expect(openSection?.querySelectorAll("ul")).toHaveLength(1);
    const openRows = [...(openSection?.querySelectorAll('[data-testid="review-home-open-row"]') ?? [])];
    expect(openRows).toHaveLength(4);

    const storyRow = openCard(openRows.find((row) => row.textContent?.includes("Comment threads"))!);
    expect(storyRow.textContent).toContain("story-only");
    expect(storyRow.textContent).not.toMatch(/#\d+/);
    expect(storyRow.querySelector('[data-testid="review-row-story-link"]')?.getAttribute("href")).toBe(
      "/projects/proj/issues/story-only",
    );

    const prRow = openCard(openRows.find((row) => row.textContent?.includes("Bump the sdk"))!);
    expect(prRow.textContent).toContain("#318");
    expect(prRow.querySelector('[data-testid="review-row-story-slot"]')).not.toBeNull();
    expect(prRow.querySelector('[data-testid="review-row-story-link"]')).toBeNull();

    const bothRow = openCard(openRows.find((row) => row.textContent?.includes("External import"))!);
    expect(bothRow.textContent).toContain("both-sources");
    expect(bothRow.textContent).toContain("#482");
    expect(bothRow.querySelector('[data-testid="review-row-story-link"]')?.getAttribute("href")).toBe(
      "/projects/proj/issues/both-sources",
    );

    const missingRow = openCard(openRows.find((row) => row.textContent?.includes("Story missing"))!);
    expect(missingRow.textContent).toContain("gone");
    expect(missingRow.textContent).toContain("#9");
    expect(missingRow.querySelector('[data-testid="review-row-story-link"]')?.getAttribute("href")).toBe(
      "/projects/proj/issues/gone",
    );

    const archived = container.querySelector('[data-testid="review-home-archived"]');
    expect(archived?.querySelectorAll("ul")).toHaveLength(1);
    const archivedRows = [...(archived?.querySelectorAll('[data-testid="review-home-archived-row"]') ?? [])];
    expect(archivedRows).toHaveLength(2);
    const archivedPr = archivedRows.find((row) => row.textContent?.includes("Capture presets"));
    expect(archivedPr?.textContent).toContain("#401");
    expect(archivedPr?.querySelector('[data-testid="review-row-story-link"]')).toBeNull();
    expect(archivedPr?.querySelector('[data-testid="review-row-story-slot"]')).not.toBeNull();
    const archivedStory = archivedRows.find((row) => row.textContent?.includes("Story detail"));
    expect(archivedStory?.querySelector('[data-testid="review-row-story-link"]')?.getAttribute("href")).toBe(
      "/projects/proj/issues/archived-story",
    );

    const ready = container.querySelector('[data-testid="review-home-ready-row"]');
    expect(ready?.querySelector('[data-testid="review-row-story-slot"]')).toBeNull();
  });
});
