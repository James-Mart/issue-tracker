// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IssueDetail, IssueRecord, ReviewView } from "@server/schemas";
import { storyReviewPath } from "../lib/links";
import { StoryCodeReviewRow } from "./story-code-review-row";

const PROJECT = "proj";
const STORY = "story-1";

const state = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
  reviews: [] as ReviewView[],
  error: null as Error | null,
  dataReady: true,
  pending: false,
  open: vi.fn(),
  mutateAsync: vi.fn(),
  enabled: true as boolean | undefined,
  progressEnabled: false as boolean | undefined,
  progressMode: "ready" as "ready" | "pending",
}));

vi.mock("@/features/issues/api/queries", () => ({
  useIssuesQuery: () => ({ data: { issues: state.issues } }),
}));

vi.mock("../api/queries", () => ({
  useReviewsQuery: (
    _projectId: string,
    _storyId: string,
    options?: { enabled?: boolean },
  ) => {
    state.enabled = options?.enabled;
    return {
      data: state.dataReady ? { reviews: state.reviews } : undefined,
      error: state.error,
      isPending: !state.dataReady && state.error === null,
    };
  },
  useReviewProgressQuery: () => {
    state.progressEnabled = true;
    if (state.progressMode === "pending") {
      return { data: undefined, error: null };
    }
    return { data: state.reviews[0]?.progress, error: null };
  },
}));

vi.mock("../api/mutations", () => ({
  useOpenReview: () => ({
    mutate: state.open,
    mutateAsync: state.mutateAsync,
    isPending: state.pending,
  }),
}));

const t0 = "2026-09-29T00:00:00.000Z";
const SHA = "abc123abc123abc123abc123abc123abc123abcd";

function story(
  overrides: Partial<Extract<IssueDetail, { kind: "story" }>> = {},
): Extract<IssueDetail, { kind: "story" }> {
  return {
    id: STORY,
    kind: "story",
    title: "Code review surface",
    description: "",
    partOf: "epic",
    order: 0,
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    version: "1",
    createdAt: t0,
    updatedAt: t0,
    ...overrides,
  };
}

function task(
  overrides: Partial<Extract<IssueRecord, { kind: "task" }>> = {},
): Extract<IssueRecord, { kind: "task" }> {
  return {
    id: "task-1",
    kind: "task",
    title: "Task",
    partOf: STORY,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    status: "done",
    commits: [SHA],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewView> = {}): ReviewView {
  return {
    id: "rev-1",
    projectId: PROJECT,
    target: { kind: "story", storyId: STORY },
    status: "open",
    postMortem: false,
    createdAt: t0,
    updatedAt: t0,
    marks: { all: {}, commits: {} },
    progress: {
      all: { reviewed: 7, total: 12, changedSinceReviewed: [] },
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

function mount(
  issues: IssueRecord[],
  storyOverrides: Partial<Extract<IssueDetail, { kind: "story" }>> = {},
): HTMLDivElement {
  state.issues = issues;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[`/projects/${PROJECT}/issues/${STORY}`]}>
        <StoryCodeReviewRow projectId={PROJECT} story={story(storyOverrides)} />
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  return container;
}

function link(container: HTMLElement): HTMLAnchorElement {
  const anchor = container.querySelector<HTMLAnchorElement>(
    '[data-testid="story-code-review-link"]',
  );
  if (!anchor) throw new Error("no code review link");
  return anchor;
}

async function click(element: Element) {
  await act(async () => {
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
  state.error = null;
  state.dataReady = true;
  state.pending = false;
  state.enabled = true;
  state.progressEnabled = false;
  state.progressMode = "ready";
  state.open.mockReset();
  state.mutateAsync.mockReset();
  lastLocation = "";
});

describe("StoryCodeReviewRow", () => {
  it("links Start review when the Story has commits and no review", () => {
    const container = mount([task()]);
    expect(container.textContent).toContain("Code review");
    expect(link(container).textContent).toBe("Start review");
    expect(link(container).getAttribute("href")).toBe(storyReviewPath(PROJECT, STORY));
    expect(container.querySelector("svg")).toBeNull();
  });

  it("links whole-review progress when the review is open", () => {
    state.reviews = [review()];
    const container = mount([task()], { merged: true });
    expect(link(container).textContent).toBe("7 / 12 files reviewed · Open");
    expect(state.progressEnabled).toBe(true);
  });

  it("shows the review link before progress loads, then fills the count", () => {
    state.progressMode = "pending";
    state.reviews = [review()];
    const pending = mount([task()]);
    expect(link(pending).textContent).toBe("Open");
    expect(link(pending).textContent).not.toContain("files reviewed");
    act(() => root?.unmount());
    root = undefined;
    state.progressMode = "ready";
    const loaded = mount([task()]);
    expect(link(loaded).textContent).toBe("7 / 12 files reviewed · Open");
  });

  it("does not request progress when the Story has no review", () => {
    const container = mount([task()]);
    expect(link(container).textContent).toBe("Start review");
    expect(state.progressEnabled).toBe(false);
  });

  it("links archived progress when the review is effectively archived", () => {
    state.reviews = [
      review({
        status: "archived",
        effectiveStatus: "archived",
        archivedReason: "merged",
        progress: {
          all: { reviewed: 14, total: 14, changedSinceReviewed: [] },
          commits: {},
        },
      } as Partial<ReviewView>),
    ];
    const container = mount([task()], { merged: true });
    expect(link(container).textContent).toBe("Archived · 14 / 14 · Open");
  });

  it("links Start post-mortem review when a merged Story has no review", () => {
    const container = mount([task()], { merged: true });
    expect(link(container).textContent).toBe("Start post-mortem review");
  });

  it("omits the row when the Story has no Task commits", () => {
    const container = mount([
      task({ id: "empty", commits: [] }),
      task({ id: "nodiff", noDiff: true, commits: [SHA] }),
      task({ id: "other", partOf: "other-story", commits: [SHA] }),
    ]);
    expect(container.textContent).not.toContain("Code review");
    expect(state.enabled).toBe(false);
  });

  it("opens or creates the review, then navigates to the workbench", async () => {
    state.mutateAsync.mockResolvedValue(undefined);
    const container = mount([task()]);
    await click(link(container));
    expect(state.mutateAsync).toHaveBeenCalledWith(STORY);
    expect(lastLocation).toBe(storyReviewPath(PROJECT, STORY));
  });

  it("stays on Story detail when open-or-create fails", async () => {
    state.mutateAsync.mockRejectedValue(new Error("refused"));
    const container = mount([task()]);
    await click(link(container));
    expect(lastLocation).toBe(`/projects/${PROJECT}/issues/${STORY}`);
  });
});
