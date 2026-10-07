// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { storyReviewPath } from "../lib/links";
import { StoryReviewPage } from "./story-review-page";

const PROJECT = "proj";
const STORY = "story-1";
const SHA = "c1d7f88aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

vi.mock("@pierre/diffs/react", () => ({
  Virtualizer: () => null,
  useVirtualizer: () => ({
    getRoot: () => document.body,
    getOffsetInScrollContainer: () => 0,
    getScrollTop: () => 0,
    markDOMDirty: () => {},
    scrollTo: () => {},
  }),
  FileDiff: () => null,
}));

let root: Root | undefined;
let urls: string[] = [];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function mount(search: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const container = document.createElement("div");
  root = createRoot(container);
  const path = `${storyReviewPath(PROJECT, STORY)}?${search}`;
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/projects/:projectId/review/stories/:storyId"
              element={<StoryReviewPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
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
  urls = [];
  vi.unstubAllGlobals();
});

describe("StoryReviewPage first wave", () => {
  beforeEach(() => {
    urls = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      urls.push(requestUrl(input));
      return new Promise(() => {});
    });
  });

  it("requests diff, commits, and comments by story id while the reviews list is pending", () => {
    mount(`tab=diff&scope=all`);

    expect(urls).toEqual(
      expect.arrayContaining([
        `/api/projects/${PROJECT}/reviews?storyId=${STORY}`,
        `/api/projects/${PROJECT}/reviews/commits?storyId=${STORY}`,
        `/api/projects/${PROJECT}/reviews/diff?storyId=${STORY}&scope=all`,
        `/api/issues/${STORY}/comments`,
      ]),
    );
    expect(urls.some((url) => /\/reviews\/[^/?]+\/(commits|diff)/.test(url))).toBe(false);
  });

  it("requests the diff scope from the URL without waiting for the commit list", () => {
    mount(`tab=diff&scope=${SHA}`);

    expect(urls).toContain(
      `/api/projects/${PROJECT}/reviews/diff?storyId=${STORY}&scope=${SHA}`,
    );
  });

  it("does not request a diff when the diff tab is closed", () => {
    mount("tab=conversation");

    expect(urls).toContain(`/api/projects/${PROJECT}/reviews/commits?storyId=${STORY}`);
    expect(urls).toContain(`/api/issues/${STORY}/comments`);
    expect(urls.some((url) => url.includes("/reviews/diff"))).toBe(false);
  });
});
