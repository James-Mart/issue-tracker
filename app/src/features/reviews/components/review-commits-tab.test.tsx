// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReviewCommits, ReviewDiff, ReviewView } from "@server/schemas";
import { ReviewCommitsPanel } from "./review-commits-tab";

const PROJECT = "proj";
const STORY = "story-1";
const TIP = "c1d7f88aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const diff: ReviewDiff = {
  scope: "all",
  files: [
    {
      path: "src/changed.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      blobSha: "changed-1",
      tooLarge: false,
    },
  ],
  patch: "",
};

vi.mock("../api/queries", () => ({
  useReviewDiffQuery: () => ({ data: diff, error: null, isLoading: false }),
}));

function reviewFixture(): ReviewView {
  return {
    id: "rev-1",
    projectId: PROJECT,
    target: { kind: "story", storyId: STORY },
    status: "open",
    postMortem: false,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    marks: { all: {}, commits: {} },
    progress: {
      all: { reviewed: 0, total: 1, changedSinceReviewed: [] },
      commits: { [TIP]: { reviewed: 0, total: 1 } },
    },
    effectiveStatus: "open",
    submissions: [],
  } as ReviewView;
}

function commitsFixture(subject: string): ReviewCommits {
  return {
    mergeBase: "main",
    mergeBaseRef: "main",
    tip: TIP,
    commits: [
      {
        sha: TIP,
        subject,
        author: "agent",
        authoredAt: "2026-09-29T00:00:00.000Z",
        files: 1,
        additions: 1,
        deletions: 0,
      },
    ],
  };
}

let root: Root | undefined;

function mountPanel(subject: string, width = "390px"): HTMLDivElement {
  const container = document.createElement("div");
  container.style.width = width;
  container.style.overflow = "hidden";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <ReviewCommitsPanel
        projectId={PROJECT}
        storyId={STORY}
        review={reviewFixture()}
        commits={{ data: commitsFixture(subject), error: null, isLoading: false }}
        scope="all"
        overrides={{}}
        onScopeChange={() => {}}
      />,
    );
  });
  return container;
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
});

describe("ReviewCommitsPanel", () => {
  it("wraps a long commit subject inside a 390px-wide panel", () => {
    const longSubject =
      "fix: stop the story review workbench from scrolling horizontally on phone and desktop while keeping vertical scroll and in-pane overflow for wide diffs without pushing submit review off-screen";
    const container = mountPanel(longSubject);

    expect(container.scrollWidth).toBeLessThanOrEqual(390);
    expect(container.textContent).toContain(longSubject);
  });
});
