// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { StoryReviewPage } from "./story-review-page";

const PROJECT = "proj";
const STORY = "story-1";

const state = vi.hoisted(() => ({
  loading: false,
  title: "Code review surface",
}));

vi.mock("@/features/issues/api/queries", () => ({
  useIssueDetailQuery: () => ({
    data: state.loading
      ? undefined
      : { id: STORY, kind: "story", title: state.title },
    error: null,
    isLoading: state.loading,
  }),
}));

vi.mock("../hooks/use-story-review-first-wave", () => ({
  useStoryReviewFirstWave: () => ({
    reviews: { data: undefined, error: null },
    commits: { data: undefined, error: null },
  }),
}));

let root: Root | undefined;

function mount(search = ""): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const path = `/projects/${PROJECT}/review/stories/${STORY}`;
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[search ? `${path}?${search}` : path]}>
        <Routes>
          <Route
            path="/projects/:projectId/review/stories/:storyId"
            element={<StoryReviewPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
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
  document.title = "Issue Tracker";
  state.loading = false;
  state.title = "Code review surface";
});

describe("StoryReviewPage tab title", () => {
  it("uses the story name and Review on every inner tab", () => {
    mount("tab=diff&scope=abc&thread=thread-1");
    expect(document.title).toBe("IT: Code review s\u2026\u00B7Review");

    act(() => root?.unmount());
    state.title = "Ship";
    mount("tab=commits");
    expect(document.title).toBe("IT: Ship\u00B7Review");
  });

  it("uses the story id until the name loads", () => {
    state.loading = true;
    mount("tab=conversation&thread=thread-1");
    expect(document.title).toBe("IT: story-1\u00B7Review");
  });
});
